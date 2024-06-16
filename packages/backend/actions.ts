import { WatchError, type RedisClientType } from "redis"; import { v4 as uuid } from "uuid";
import { Stats, WorkerHeartbeatResponse, WorkerRegistration } from "@distributed-computing/types";
import { Answer } from "@distributed-computing/types";
import { Task, WorkerHeartbeat, ClaimSubTaskRequest, ClaimedSubTask, CreateTaskRequest, SubTask } from "@distributed-computing/types";

const HEARTBEAT_EXPIRE_SECONDS = 120;

const WORDLIST_LENGTHS = {
  "rockyou.txt": 14344391,
  "piotrcki-wordlist-top10m.txt": 9872702,
  "ezpz.txt": 1000,

} satisfies Record<SubTask["wordlist"], number>;


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
const TASK_KEY = (taskId: string) => `${TASKS_KEY}:${taskId}`;
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

/**
 * use with SADD, SREM
 */
const SOLVED_TASKS_KEY = "solved_tasks";

//eslint-disable-next-line func-style
const HEARTBEAT_KEY = (taskId: string, subtaskIndex: string) => `heartbeat:${taskId}:${subtaskIndex}`;

//eslint-disable-next-line func-style
const WORKER_DATA_KEY = (workerId: string) => `worker:${workerId}`;


export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

export const defaultLogger: Logger = {
  log: (message) => console.log(new Date(), "LOG", message),
  warn: (message) => console.log(new Date(), "WARN", message),
  error: (message) => console.log(new Date(), "ERROR", message),
  debug: (message) => console.log(new Date(), "DEBUG", message),
};

export async function addTask(req: CreateTaskRequest, client: RedisClientType, logger = defaultLogger): Promise<void> {
  const { name, subtaskRangeLen, wordlist, algo, passwordHash: password } = CreateTaskRequest.parse(req);
  const subtasks: SubTask[] = [];
  logger.log(`Computing subtasks - ${subtaskRangeLen} wordlist lines per subtask`);
  for (
    let i = 0;
    i < WORDLIST_LENGTHS[wordlist];
    i += subtaskRangeLen
  ) {
    subtasks.push({
      password,
      algo,
      wordlist,
      wordlistLineRange: [i, i + subtaskRangeLen - 1],
    });
  }
  const task: Task = {
    id: uuid(),
    name: name,
    subtaskCount: subtasks.length,
    answer: null,
  };

  logger.log(`Computed ${subtasks.length} subtasks`);
  logger.log(`Adding subtasks to task ${task.id}`);
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    // await client.executeIsolated(async (isolatedClient) => {
    //   await isolatedClient.watch(SUBTASKS_KEY(taskId));
    //   await isolatedClient.watch(CLAIMED_SUBTASKS_KEY(taskId));

    //   const multi = isolatedClient.multi()
    //     .ping();
    //   subTaskId = await isolatedClient.rPop(SUBTASKS_KEY(taskId));
    //   if (subTaskId === null) {
    //     return multi.discard();
    //   }
    //   multi.hSet(CLAIMED_SUBTASKS_KEY(taskId), subTaskId, workerId);
    //   const result = await multi.exec();
    //   if (result === null) {
    //     return multi.discard();
    //   }
    // });
    const subTask = await client.rPop(SUBTASKS_KEY(taskId));
    if (subTask === null) {
      logger.warn(`No more subtasks left for task ${taskId}`);
      return null;
    }
    subTaskId = subTask;
    await client.hSet(CLAIMED_SUBTASKS_KEY(taskId), subTaskId, workerId);
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
      .sRem(CLAIMED_SUBTASKS_KEY(taskId), subTaskId)
      .rPush(TASKS_KEY, taskId)
      .exec();
    logger.warn(`Heartbeat missed for task ${taskId}, belonging to worker ${workerId}, returning task to queue`);
    return { success: false };
  }
}

export async function cleanupExpiredHeartbeats(client: RedisClientType, logger = defaultLogger): Promise<void> {
  // todo proofread
  const taskKeys = await client.keys(`heartbeat:*`);
  const heartbeats = await Promise.all(taskKeys.map((key) => client.get(key)));
  const expired = heartbeats.filter((nonce) => nonce === null);
  if (expired.length === 0) {
    logger.log("No expired heartbeats found");
    return;
  }
  logger.log(`Cleaning up ${expired.length} expired heartbeats`);
  await Promise.all(expired.map((nonce) => client.del(nonce)));
  logger.log("Cleaned up expired heartbeats");
}

export async function getAllTasks(client: RedisClientType, logger = defaultLogger): Promise<Task[]> {
  const taskIds = await client.lRange(TASKS_KEY, 0, -1);
  const solvedTaskIds = await client.sMembers(SOLVED_TASKS_KEY);
  const tasks = await Promise.all(taskIds.map((taskId) => getTask(taskId, client, logger)));
  const solvedTasks = await Promise.all(solvedTaskIds.map((taskId) => getTask(taskId, client, logger)));
  const result = [
    ...tasks.filter((task): task is Task => task !== null),
    ...solvedTasks.filter((task): task is Task => task !== null),
  ];
  return result;
}

export async function getTask(taskId: string, client: RedisClientType, logger = defaultLogger): Promise<Task | null> {
  const task = await client.get(TASK_KEY(taskId));
  if (task === null) {
    return null;
  }
  logger.log(`Getting task ${taskId}`);
  const taskObj = JSON.parse(task);
  return Task.parse(taskObj);
}

export async function registerWorker(client: RedisClientType, logger = defaultLogger): Promise<WorkerRegistration> {
  const workerId = uuid();
  const workerSecret = Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
  logger.log(`Registering worker ${workerId}`);
  await client.set(WORKER_DATA_KEY(workerId), workerSecret);
  return WorkerRegistration.parse({
    workerId,
    workerSecret,
  });
}

export async function issueWorkerToken() {}
export async function verifyWorkerToken() {}

// TODO other worker functions


export async function getSubTask(taskId: string, subTaskId: string, client: RedisClientType, logger = defaultLogger): Promise<SubTask | null> {
  const subTaskKey = SUBTASK_KEY(taskId, subTaskId);
  const subTask = await client.get(subTaskKey);
  if (subTask === null) {
    return null;
  }
  logger.log(`Getting subtask ${subTaskId} from task ${taskId}`);
  logger.log(subTask);
  const obj = JSON.parse(subTask);
  logger.log(obj);
  logger.log(`Task is ${subTask}`);
  return SubTask.parse(obj);
}


//entirely wrong, need to get the subtask by retrieving the task and then getting the taskId
export async function sendAnswer(answer: Answer, client: RedisClientType, logger = defaultLogger): Promise<Task | null> {
  const { taskId, subTaskId, answerString } = Answer.parse(answer);
  const task = await getTask(taskId, client, logger);
  if (!task) {
    logger.error(`Could not find task ${taskId}`);
    return null;
  }
  const subTaskKey = SUBTASK_KEY(taskId, String(subTaskId));
  const subTask = await client.get(subTaskKey);
  if (subTask === null) {
    return null;
  }
  if (!answerString) {
    logger.warn(`Answer for subtask ${subTaskId} is empty`);
    await client.hDel(CLAIMED_SUBTASKS_KEY(taskId), subTaskId);
    return null;
  }
  logger.log(`Storing answer for subtask ${subTaskId}`);
  const updatedTask = { ...task, answer: answerString } satisfies Task;
  await client.multi()
    .set(TASK_KEY(taskId), JSON.stringify(updatedTask))
    .sAdd(SOLVED_TASKS_KEY, taskId)
    .hDel(CLAIMED_SUBTASKS_KEY(taskId), subTaskId)
    // delete all subtasks
    .lTrim(SUBTASKS_KEY(taskId), 0, 0)
    .lRem(TASKS_KEY, 0, taskId)
    .exec();
  await Promise.all((await client.keys(SUBTASK_KEY(taskId, "*"))).map((key) => client.del(key)));
  logger.log(`Stored answer for subtask ${subTaskId}`);
  return updatedTask;
}

export async function getStats(client: RedisClientType, logger = defaultLogger): Promise<Stats> {
  logger.log("Getting stats");
  const totalTasks = await client.lLen(TASKS_KEY);
  const [subtasksQueued, subtasksClaimed, tasksSolved] = await client.eval(
    `
    local subtasksKeys = redis.call("KEYS", KEYS[1])
    local subtasksQueued = 0
    for _, subtaskKey in ipairs(subtasksKeys) do
      local count = redis.call("LLEN", subtaskKey)
      subtasksQueued = subtasksQueued + count
    end
    local claimedSubtasksKeys = redis.call("KEYS", KEYS[2])
    local subtasksClaimed = 0
    for _, claimedSubtaskKey in ipairs(claimedSubtasksKeys) do
      local count = redis.call("HLEN", claimedSubtaskKey)
      subtasksClaimed = subtasksClaimed + count
    end
    local tasksSolved = redis.call("SCARD", KEYS[3])
    return { subtasksQueued, subtasksClaimed, tasksSolved }
  `, {
      keys: [SUBTASKS_KEY("*"), CLAIMED_SUBTASKS_KEY("*"), SOLVED_TASKS_KEY],
    },
  ) as [number, number, number] | undefined ?? [0, 0, 0];
  const totalSubTasks = subtasksQueued + subtasksClaimed;
  return Promise.resolve({
    totalTasks,
    totalSubTasks,
    subtasksQueued,
    subtasksClaimed,
    tasksSolved,
  });
}
