import { type RedisClientType } from "redis";
import { v4 as uuid } from "uuid";
import type { Task, TaskClaim, WorkerHeartbeat, WorkerHeartbeatResponse } from "./models.ts";
import { CreateTaskRequest } from "./models.ts";

// Actions

export async function addTask(req: CreateTaskRequest, client: RedisClientType): Promise<void> {
  const validReq = CreateTaskRequest.parse(req);
  const task: Task = {
    id: uuid(),
    name: validReq.name,
    subtasks: validReq.subtasks,
  };
  await client.set(task.id, JSON.stringify(task));
  await client.lPush("tasks", task.id);
}

export async function claimTask(client: RedisClientType): Promise<TaskClaim> {
  const nextHeartBeatNonce = uuid();
  const expireSeconds = 60;
  // closest thing to a transaction
  const taskId = await client.eval(`
    local task = redis.call("RPOP", "tasks");
    redis.call("SADD", "claimed_tasks", task);
    local heartbeatKey = "heartbeats:" .. task;
    local nextNonce = ARGV[1];
    local expireSeconds = ARGV[2];
    redis.call("SET", heartbeatKey, nextNonce);
    redis.call("EXPIRE", heartbeatKey, expireSeconds);
    return task;
  `, {
    arguments: [nextHeartBeatNonce, String(expireSeconds)], 
  }) as string;
  return {
    taskId,
    heartbeat: {
      success: true,
      nextHeartBeatNonce,
    },
  };
}

export async function heartbeat(beat: WorkerHeartbeat, client: RedisClientType): Promise<WorkerHeartbeatResponse> {
  const nextHeartBeatNonce = uuid();
  // TODO implement
  // check if the nonce matches the last nonce, and if so, success
  const expireSeconds = 60;
  const success = Boolean(await client.eval(`
    local taskId = ARGV[1];
    local requestNonce = ARGV[2];
    local nextNonce = ARGV[3]
    local expireSeconds = ARGV[4];
    local heartbeatKey = "heartbeats:" .. taskId;
    local nonce = redis.call("GET", heartbeatKey);
    if requestNonce == nonce then
      redis.call("SET", heartbeatKey, nextNonce)
      redis.call("EXPIRE", heartbeatKey, expireSeconds);
      return true
    else
      -- do nothing, for now
      -- TODO implement task failover
      return false
    end
  `, {
    arguments: [beat.taskId, beat.nonce, nextHeartBeatNonce, String(expireSeconds)],
  }));

  if (!success) {
    return { success };
  }

  return {
    success: true,
    nextHeartBeatNonce,
  };
}
