import z from "zod";

const SubTask = z.object({
  password: z.string().min(1).max(120),
  wordlist: z.enum(["piotrcki-wordlist-top10m.txt", "rockyou.txt"]),
  /**
     * This being a tuple of lines of the wordlist to consider, e.g. [1, 17] searches only through lines from 1 to 17 of an e.g. 10k line file
     * Line 1 being the first line.
     */
  wordlistLineRange: z.tuple([z.number(), z.number()]),
});
export const CreateTaskRequest = z.object({
  name: z.string().min(1).max(30),
  subtasks: z.array(SubTask),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const ClaimTaskRequest = z.object({
  workerId: z.string().uuid(),
});
export type ClaimTaskRequest = z.infer<typeof ClaimTaskRequest>

export const Task = CreateTaskRequest.extend({
  id: z.string().uuid(),
});
export type Task = z.infer<typeof Task>;

export const WorkerHeartbeat = z.object({
  taskId: z.string().uuid(),
  workerId: z.string().uuid(),
  nonce: z.string(),
});
export type WorkerHeartbeat = z.infer<typeof WorkerHeartbeat>;

export const WorkerHeartbeatResponse = z.object({
  success: z.literal(true),
  nextHeartBeatNonce: z.string(),
}).or(z.object({
  success: z.literal(false),
}));
export type WorkerHeartbeatResponse = z.infer<typeof WorkerHeartbeatResponse>;

export const ClaimedTask = z.object({
  taskId: z.string().uuid(),
  heartbeat: WorkerHeartbeatResponse,
});
export type ClaimedTask = z.infer<typeof ClaimedTask>;

export const Stats = z.object({
  tasksQueued: z.number(),
  tasksClaimed: z.number(),
  totalTasks: z.number(),
});
export type Stats = z.infer<typeof Stats>;
