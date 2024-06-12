import type { ClaimedSubTask, SubTask, Task, WorkerHeartbeat, WorkerHeartbeatResponse } from "@distributed-computing/types";
import { type ClaimSubTaskRequest } from "@distributed-computing/types";

export async function tryClaimSubTask(server: string, { taskId, workerId }: ClaimSubTaskRequest): Promise<ClaimedSubTask> {
  return fetch(`${server}/api/task/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workerId,
      taskId,
    }),
  })
    .catch((err) => {
      console.error("error while claiming task", err);
      return Promise.reject(err);
    })
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`request failed with status ${resp.status}`);
      }
      return resp.json();
    });
}

export async function heartbeat(server: string, {
  workerId,
  taskId,
  subTaskId,
  nonce,
}: WorkerHeartbeat): Promise<WorkerHeartbeatResponse> {
  return fetch(`${server}/api/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      workerId,
      taskId,
      subTaskId,
      nonce,
    }),
  })
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`request failed with status ${resp.status}`);
      }
      return resp.json();
    },
    )
    .catch((err) => {
      console.error("error while sending heartbeat", err);
      return Promise.reject(err);
    });
}

export async function getTaskInfo(server: string, taskId: string): Promise<Task> {
  return fetch(`${server}/api/task/${taskId}`)
    .catch((err) => {
      console.error("error while getting task info", err);
      return Promise.reject(err);
    })
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`request failed with status ${resp.status}`);
      }
      return resp.json();
    });
}

export async function getSubTaskInfo(server: string, taskId: string, subtaskId: string): Promise<SubTask> {
  return fetch(`${server}/api/task/${taskId}/subtask/${subtaskId}`)
    .catch((err) => {
      console.error("error while getting subtask info", err);
      return Promise.reject(err);
    })
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`request failed with status ${resp.status}`);
      }
      return resp.json();
    });
}

export function getAllTasks(server: string): Promise<Task[]> {
  return fetch(`${server}/api/task`)
    .catch((err) => {
      console.error("error while getting all tasks", err);
      return Promise.reject(err);
    })
    .then(async (resp) => {
      if (!resp.ok) {
        throw new Error(`request failed with status ${resp.status}`);
      }
      return resp.json();
    });
}
