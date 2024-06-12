import { createInterface as createReadlineInterface } from "readline";
import { createReadStream } from "fs";
import { join } from "path";
import { createHash } from "crypto";

import { v4 as uuid } from "uuid";

import {
  heartbeat,
  tryClaimSubTask,
  getTaskInfo,
  getAllTasks,
  getSubTaskInfo,
} from "./api.ts";
import { SubTask } from "@distributed-computing/types";

const WORDLISTS = SubTask.shape.wordlist.options;
const ALGOS = SubTask.shape.algo.options;
const HEARTBEAT_UPDATE_INTERVAL = 10_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    if (subtask.heartbeat.success !== true) {
      throw new Error(
        "failed to claim subtask, somehow got failed heartbeat on claim",
        { cause: subtask },
      );
    }
    const subtaskInfo = await getSubTaskInfo(
      QUEUE_SERVER,
      task.id,
      subtask.subTaskId,
    );
    const { algo, password, wordlist, wordlistLineRange } = subtaskInfo;
    if (!WORDLISTS.includes(wordlist)) {
      throw new Error("invalid wordlist", { cause: wordlist });
    }
    if (!ALGOS.includes(algo)) {
      throw new Error("invalid algo", { cause: algo });
    }
    // TODO compute
    const rli = createReadlineInterface(
      createReadStream(join(__dirname, "wordlists/", wordlist)),
    );
    let lineNum = 0;
    let lastHeartBeatTime = Date.now();
    let lastHeartBeatNonce = subtask.heartbeat.nextHeartBeatNonce;
    let answer = null;
    const interval = setInterval(async () => {
      if (Date.now() - lastHeartBeatTime > HEARTBEAT_UPDATE_INTERVAL) {
        const res = await heartbeat(QUEUE_SERVER, {
          taskId: task.id,
          subTaskId: subtask.subTaskId,
          workerId,
          nonce: lastHeartBeatNonce,
        });
        if (res.success !== true) {
          throw new Error("failed to send heartbeat", { cause: res });
        }
        lastHeartBeatNonce = res.nextHeartBeatNonce;
        lastHeartBeatTime = Date.now();
      }
    }, HEARTBEAT_UPDATE_INTERVAL);
    rli.on("line", async (line) => {
      const currentLineNum = lineNum++;
      const [start, end] = wordlistLineRange;
      if (currentLineNum < start || currentLineNum > end) {
        return;
      }
      const hash = createHash(algo).update(line).digest("hex");
      if (hash === password) {
        clearInterval(interval);
        console.log(new Date(), "Found password", line);
        answer = line;
        rli.close();
      }
    });

    await new Promise<void>((resolve) =>
      rli.on("close", async () => {
        clearInterval(interval);
        console.log(new Date(), "Subtask done");
        resolve();
      }),
    );
    console.log(new Date(), "Sending answer", answer);
    // TODO send answer and implement sendAnswer
    // await sendAnswer(QUEUE_SERVER, task.id, subtask.subTaskId, answer);
    await sleep(HEARTBEAT_UPDATE_INTERVAL);
  } catch (error) {
    console.error("Error while processing task", error);
    await sleep(HEARTBEAT_UPDATE_INTERVAL);
  }
}
