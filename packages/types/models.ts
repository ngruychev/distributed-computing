import z from "zod";


export const SubTask = z.object({
  password: z.string().min(1).max(120),
  algo: z.enum(["SHA256", "SHA512", "MD5"]),
  wordlist: z.enum(["piotrcki-wordlist-top10m.txt", "rockyou.txt", "ezpz.txt"]),
  /**
     * This being a tuple of lines of the wordlist to consider, e.g. [1, 17] searches only through lines from 1 to 17 of an e.g. 10k line file
     * Line 1 being the first line.
     */
  wordlistLineRange: z.tuple([z.number(), z.number()]),
});
export type SubTask = z.infer<typeof SubTask>;

export const CreateTaskRequest = z.object({
  name: z.string().min(1).max(30),
  algo: z.enum(["SHA256", "SHA512", "MD5"]),
  wordlist: z.enum(["piotrcki-wordlist-top10m.txt", "rockyou.txt", "ezpz.txt"]),
  passwordHash: z.string().min(1).max(120),
  // subtasks: z.array(SubTask),
  subtaskRangeLen: z.number().gt(5).lt(10_000),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const ClaimSubTaskRequest = z.object({
  workerId: z.string().uuid(),
  taskId: z.string().uuid(),
});
export type ClaimSubTaskRequest = z.infer<typeof ClaimSubTaskRequest>

export const Task = z.object({
  name: z.string().min(1).max(30),
  id: z.string().uuid(),
});
export type Task = z.infer<typeof Task>;

export const WorkerHeartbeat = z.object({
  taskId: z.string().uuid(),
  subTaskId: z.string().uuid(),
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

export const ClaimedSubTask = z.object({
  taskId: z.string().uuid(),
  subTaskId: z.string(),
  heartbeat: WorkerHeartbeatResponse,
});
export type ClaimedSubTask = z.infer<typeof ClaimedSubTask>;

const SolvedSubTask = z.object({});
type SolvedSubTask = z.infer<typeof SolvedSubTask>;

const SolvedTask = z.object({});
type SolvedTask = z.infer<typeof SolvedTask>;

export const Stats = z.object({
  totalTasks: z.number(),
  subtasksQueued: z.number(),
  subtasksClaimed: z.number(),
  totalSubTasks: z.number(),
});
export type Stats = z.infer<typeof Stats>;


export const Answer = z.object({
  subTaskId: z.string().uuid(),
  answerId: z.string().uuid(),
  description: z.string().min(1),
});
export type Answer = z.infer<typeof Answer>;
