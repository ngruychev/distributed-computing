import { heartbeat, tryClaimSubTask, getTaskInfo, getAllTasks, getSubTaskInfo } from "./api.ts";
import { v4 as uuid } from "uuid";

const QUEUE_SERVER = "http://backend:3000/";

const workerId = uuid();

while (true) {
  try {
    const [task] = await getAllTasks(QUEUE_SERVER);
    console.log(new Date(), `Got task ${task.id}`);
    const subtask = await tryClaimSubTask(QUEUE_SERVER, {
      workerId,
      taskId: task.id,
    });
    const subtaskInfo = await getSubTaskInfo(QUEUE_SERVER, task.id, subtask.subTaskId);
    const { algo, password, wordlist, wordlistLineRange } = subtaskInfo;
    // TODO compute
  } catch (error) {
    console.error("Error while processing task", error);
  }
}
