import { type ClaimedTask, type ClaimTaskRequest } from "@distributed-computing/types";

export async function tryClaimTask(server: string, { workerId }: ClaimTaskRequest) {
  try {
    const response = await fetch(`${server}/api/task/claim`, {
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workerId,
      }),
    });
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error("error while claiming task", error);
  }
}

export async function heartbeat(server: string) {
  // TODO implement
}

export async function getTaskInfo(server: string, task: ClaimedTask) {
  // TODO implement
}
