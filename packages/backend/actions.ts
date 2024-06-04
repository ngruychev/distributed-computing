import { WatchError, type RedisClientType } from "redis"; import { v4 as uuid } from "uuid";
import type { Stats, WorkerHeartbeatResponse } from "@distributed-computing/types";
import { Task, WorkerHeartbeat, ClaimSubTaskRequest, ClaimedSubTask, CreateTaskRequest, SubTask } from "@distributed-computing/types";

const HEARTBEAT_EXPIRE_SECONDS = 60;

/**
 * use with LPUSH, RPOP
 * @kind redis key
 */
const TASKS_KEY = "tasks";
/**
  * use with SET, GET
  * @returns redis key
  */
// eslint-disable-next-line func-style
const TASK_KEY = (taskId: string) => `${TASK_KEY}:${taskId}`;
/**
  * use with LPUSH, RPOP
  * @returns redis key
  */
// eslint-disable-next-line func-style
const SUBTASKS_KEY = (taskId: string) => `${TASK_KEY(taskId)}:subtasks`;
/**
  * use with SET, GET
  * @returns redis key
  */
// eslint-disable-next-line func-style
const SUBTASK_KEY = (taskId: string, subtaskIndex: string) => `${SUBTASKS_KEY(taskId)}:${subtaskIndex}`;
/**
  * use with HSET, HGET
  * @param taskId the task id
  * @returns redis key
  */
// eslint-disable-next-line func-style
const CLAIMED_SUBTASKS_KEY = (taskId: string) => `${TASK_KEY(taskId)}:claimed_subtasks`;
/**
  * use with SET, GET, EXPIRE (or SET with EX)
  * @returns redis key
  */
//eslint-disable-next-line func-style
const HEARTBEAT_KEY = (taskId: string, subtaskIndex: string) => `heartbeat:${taskId}:${subtaskIndex}`;


export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

export const defaultLogger: Logger = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: (message) => console.debug(message),
};

export async function addTask(req: CreateTaskRequest, client: RedisClientType, logger = defaultLogger): Promise<void> {
  const { name, subtasks } = CreateTaskRequest.parse(req);
  const task: Task = {
    id: uuid(),
    name: name,
  };
  for (const [index, subtask] of subtasks.entries()) {
    await client.multi()
      .set(SUBTASK_KEY(task.id, String(index)), JSON.stringify(subtask))
      .lPush(SUBTASKS_KEY(task.id), String(index))
      .exec();
  }
  await client.multi()
    .set(TASK_KEY(task.id), JSON.stringify(task))
    .lPush(TASKS_KEY, task.id)
    .exec();
  logger.log(`Added task "${task.name}" with id ${task.id} and ${subtasks.length} subtasks`);
}

export async function claimSubTask(req: ClaimSubTaskRequest, client: RedisClientType, logger = defaultLogger): Promise<ClaimedSubTask | null> {
  const { workerId, taskId } = ClaimSubTaskRequest.parse(req);
  let task;
  try {
    const taskStr = await client.get(TASK_KEY(taskId));
    if (!taskStr) {
      logger.error(`Could not get task ${taskId}: not found`);
      return null;
    }
    task = JSON.parse(taskStr) as Task;
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Error: ${error.message}`);
      logger.error(`Could not get task ${taskId}: ${error instanceof SyntaxError ? "could not parse task" : "unexpected error"}`);
    } else {
      logger.error(`Could not get task ${taskId}: unexpected unknown error`);
    }
    return null;
  }
  let subTaskId = null;
  try {
    await client.executeIsolated(async (isolatedClient) => {
      await isolatedClient.watch(SUBTASKS_KEY(taskId));
      await isolatedClient.watch(CLAIMED_SUBTASKS_KEY(taskId));

      const multi = isolatedClient.multi()
        .ping();
      subTaskId = await isolatedClient.rPop(SUBTASKS_KEY(taskId));
      if (subTaskId === null) {
        return multi.discard();
      }
      multi.hSet(CLAIMED_SUBTASKS_KEY(taskId), subTaskId, workerId);
      const result = await multi.exec();
      if (result === null) {
        return multi.discard();
      }
    });
  } catch (error) {
    if (error instanceof WatchError) {
      logger.error(`Could not get task for worker ${workerId}, unexpected watch error ${error.message}`);
    } else if (error instanceof Error) {
      logger.error(`Could not get task for worker ${workerId}, unexpected error ${error.message}`);
    } else {
      logger.error(`Could not get task for worker ${workerId}, unexpected unknown error`);
    }
    throw new Error("Couldn't get task");
  }
  if (subTaskId === null || subTaskId === undefined) {
    logger.error(`Could not get task for worker ${workerId}, no more tasks left`);
    throw new Error("Couldn't get task");
  }
  logger.log(`Claimed task ${taskId} for worker ${workerId}`);
  const nextHeartBeatNonce = uuid();
  await client.set(HEARTBEAT_KEY(taskId, subTaskId), nextHeartBeatNonce, {
    EX: HEARTBEAT_EXPIRE_SECONDS,
  });
  logger.log(`Set a heartbeat for ${taskId} with nonce ${nextHeartBeatNonce}, expiring in ${HEARTBEAT_EXPIRE_SECONDS}`);
  const claimedTask = ClaimedSubTask.parse({
    taskId,
    subTaskId,
    heartbeat: {
      success: true,
      nextHeartBeatNonce,
    },
  } satisfies ClaimedSubTask);
  return claimedTask;
}

export async function heartbeat(beat: WorkerHeartbeat, client: RedisClientType, logger = defaultLogger): Promise<WorkerHeartbeatResponse> {
  const { workerId, taskId, subTaskId, nonce } = WorkerHeartbeat.parse(beat);
  const nextHeartBeatNonce = uuid();
  const heartbeatKey = HEARTBEAT_KEY(taskId, subTaskId);
  const actualNonce = await client.get(heartbeatKey);
  if (nonce === actualNonce) {
    await client.set(heartbeatKey, nextHeartBeatNonce, {
      EX: HEARTBEAT_EXPIRE_SECONDS,
    });
    logger.log(`Heartbeat for task ${taskId} updated successfully by worker ${workerId}, setting nonce to ${nextHeartBeatNonce}`);
    return {
      success: true,
      nextHeartBeatNonce,
    };
  } else {
    await client.multi()
      .sRem("claimed_tasks", taskId)
      .lPush("tasks", taskId)
      .exec();
    logger.warn(`Heartbeat missed for task ${taskId}, belonging to worker ${workerId}, returning task to queue`);
    return { success: false };
  }
}

export async function getTask(taskId: string, client: RedisClientType, logger = defaultLogger): Promise<Task | null> {
  const taskKey = `tasks:${taskId}`;
  const task = await client.get(taskKey);
  if (task === null) {
    return null;
  }
  logger.log(`Getting task ${taskId}`);
  return Task.parse(task);
}

export async function getSubTask(taskId: string, subTaskId: string, client: RedisClientType, logger = defaultLogger): Promise<SubTask | null> {
  const subTaskKey = SUBTASK_KEY(taskId, subTaskId);
  const subTask = await client.get(subTaskKey);
  if (subTask === null) {
    return null;
  }
  logger.log(`Getting subtask ${subTaskId} from task ${taskId}`);
  return SubTask.parse(subTask);
}

export async function getStats(client: RedisClientType, logger = defaultLogger): Promise<Stats> {
  logger.log("Getting stats");
  const totalTasks = await client.lLen(TASKS_KEY);
  return Promise.resolve({
    totalTasks,
    tasksQueued,
    totalSubTasks,
    subtasksQueued,
    subtasksClaimed,
  });
}
