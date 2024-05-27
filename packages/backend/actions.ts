import { WatchError, type RedisClientType } from "redis"; import { v4 as uuid } from "uuid";
import type { Stats, WorkerHeartbeatResponse } from "@distributed-computing/types";
import { Task, WorkerHeartbeat, ClaimTaskRequest, ClaimedTask, CreateTaskRequest } from "@distributed-computing/types";

const HEARTBEAT_EXPIRE_SECONDS = 60;

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
    subtasks: subtasks,
  };
  const taskKey = `tasks:${task.id}`;
  await client.multi()
    .set(taskKey, JSON.stringify(task))
    .lPush("tasks", task.id)
    .exec();
  logger.log(`Added task "${task.name}" with id ${task.id} and ${task.subtasks.length} subtasks`);
}

export async function claimTask(req: ClaimTaskRequest, client: RedisClientType, logger = defaultLogger): Promise<ClaimedTask> {
  const { workerId } = ClaimTaskRequest.parse(req);
  let taskId = null as string | null;
  try {
    await client.executeIsolated(async (isolatedClient) => {
      await isolatedClient.watch("tasks");
      await isolatedClient.watch("claimed_tasks");

      const multi = isolatedClient.multi()
        .ping();
      taskId = await isolatedClient.rPop("tasks");
      if (taskId == null) {
        return multi.exec();
      }
      multi.hSet("claimed_tasks", taskId, workerId);
      return multi.exec();
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
  if (taskId === null) {
    logger.error(`Could not get task for worker ${workerId}, no more tasks left`);
    throw new Error("Couldn't get task");
  }
  const heartbeatKey = `heartbeats:${taskId}`;
  const nextHeartBeatNonce = uuid();
  await client.set(heartbeatKey, nextHeartBeatNonce, {
    EX: HEARTBEAT_EXPIRE_SECONDS,
  });
  logger.log(`Claimed task ${taskId} for worker ${workerId} and set a heartbeat with nonce ${nextHeartBeatNonce}, expiring in ${HEARTBEAT_EXPIRE_SECONDS}`);
  const claimedTask = ClaimedTask.parse({
    taskId,
    heartbeat: {
      success: true,
      nextHeartBeatNonce,
    },
  } satisfies ClaimedTask);
  return claimedTask;
}

export async function heartbeat(beat: WorkerHeartbeat, client: RedisClientType, logger = defaultLogger): Promise<WorkerHeartbeatResponse> {
  const { workerId, taskId, nonce } = WorkerHeartbeat.parse(beat);
  const nextHeartBeatNonce = uuid();
  const heartbeatKey = `heartbeats:${taskId}`;
  const actualNonce = await client.get(heartbeatKey);
  if (nonce === actualNonce) {
    // Heartbeat successful
    await client.set(heartbeatKey, nextHeartBeatNonce, {
      EX: HEARTBEAT_EXPIRE_SECONDS,
    });
    logger.log(`Heartbeat for task ${taskId} updated successfully by worker ${workerId}, setting nonce to ${nextHeartBeatNonce}`);
    return {
      success: true,
      nextHeartBeatNonce,
    };
  } else {
    // Heartbeat missed, task goes to someone else
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

export async function getStats(client: RedisClientType, logger = defaultLogger): Promise<Stats> {
  const tasksQueued = await client.lLen("tasks");
  const tasksClaimed = await client.lLen("claimed_tasks");
  const totalTasks = tasksQueued + tasksClaimed;
  logger.log("Getting stats");
  return Promise.resolve({
    tasksQueued,
    tasksClaimed,
    totalTasks,
  });
}
