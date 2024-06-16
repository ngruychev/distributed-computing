import { createInterface as createReadlineInterface } from "readline";
import { createReadStream } from "fs";
import { join } from "path";
import { createHash } from "crypto";

import { v4 as uuid } from "uuid";

import {
  heartbeat,
  tryClaimSubTask,
  getAllTasks,
  getSubTaskInfo,
  sendAnswer,
} from "./api.ts";
import type { Answer, ClaimedSubTask } from "@distributed-computing/types";
import { SubTask } from "@distributed-computing/types";

const WORDLISTS = SubTask.shape.wordlist.options;
const ALGOS = SubTask.shape.algo.options;
const HEARTBEAT_UPDATE_INTERVAL = 5_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { BACKEND_HOST, BACKEND_PORT } = process.env;
const QUEUE_SERVER = `http://${BACKEND_HOST ?? 'backend'}:${BACKEND_PORT ?? '3000'}`;

const workerId = uuid();

async function compute({ wordlistLineRange, algo, password, wordlist }: SubTask): Promise<string | null> {
    const rli = createReadlineInterface(
      createReadStream(join(import.meta.dirname, "./../", "./../", "./wordlists/", wordlist)),
    );
    let lineNum = 0;
    let answer: string | null = null;

    rli.on("line", async (line) => {
      const currentLineNum = lineNum++;
      const [start, end] = wordlistLineRange;
      if (currentLineNum < start || currentLineNum > end) {
        return;
      }
      const hash = createHash(algo).update(line).digest("hex");
      console.log(new Date(), "Checking", JSON.stringify(line), hash, password);
      if (hash === password) {
        console.log(new Date(), "Found password", line);
        answer = line;
        rli.close();
      }
    });

    return await new Promise((resolve) =>
      rli.on("close", async () => {
        console.log(new Date(), "Subtask done");
        resolve(answer);
      }),
    );
}

async function main() {
  let claimedSubtask: ClaimedSubTask | null = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      console.log(new Date(), "Getting all tasks");
      const tasks = await getAllTasks(QUEUE_SERVER);
      const [task] = tasks;
      console.log(new Date(), "Got tasks", tasks.length, task);
      if (tasks.length === 0) {
        await sleep(HEARTBEAT_UPDATE_INTERVAL);
        continue;
      }
      console.log(new Date(), `Got task ${task.id}`);
      console.log(new Date(), "Claiming subtask", task.id);
      if (!claimedSubtask) {
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
        claimedSubtask = subtask;
      } else {
        // Nothing to do
      }
      const subtaskInfo = await getSubTaskInfo(
        QUEUE_SERVER,
        task.id,
        claimedSubtask.subTaskId,
      );
      const { algo, wordlist, wordlistLineRange } = subtaskInfo;
      if (!WORDLISTS.includes(wordlist)) {
        throw new Error("invalid wordlist", { cause: wordlist });
      }
      if (!ALGOS.includes(algo)) {
        throw new Error("invalid algo", { cause: algo });
      }
      if (wordlistLineRange[0] < 0 || wordlistLineRange[1] < 0 || wordlistLineRange[0] > wordlistLineRange[1]) {
        throw new Error("invalid wordlistLineRange", { cause: wordlistLineRange });
      }
      let lastHeartBeatTime = Date.now();
      if (!claimedSubtask.heartbeat.success) {
        throw new Error("failed to claim subtask", { cause: claimedSubtask });
      }
      let lastHeartBeatNonce = claimedSubtask.heartbeat.nextHeartBeatNonce;
      //
      const interval = setInterval(async () => {
        if (Date.now() - lastHeartBeatTime > HEARTBEAT_UPDATE_INTERVAL) {
          const res = await heartbeat(QUEUE_SERVER, {
            taskId: task.id,
            subTaskId: claimedSubtask!.subTaskId,
            workerId,
            nonce: lastHeartBeatNonce,
          });
          if (res.success !== true) {
            clearInterval(interval);
            claimedSubtask = null;
            throw new Error("failed to send heartbeat", { cause: res });
          }
          lastHeartBeatNonce = res.nextHeartBeatNonce;
          lastHeartBeatTime = Date.now();
        }
      }, HEARTBEAT_UPDATE_INTERVAL);
      const answer = await compute(subtaskInfo);
      if (answer) {
        clearInterval(interval);
      }
      console.log(new Date(), "Sending answer", answer);
      if (answer) {
        const answerPayload: Answer = {
          taskId: task.id,
          subTaskId: claimedSubtask.subTaskId,
          answerString: answer,
        };
        await sendAnswer(QUEUE_SERVER, answerPayload);
      }
      await sleep(HEARTBEAT_UPDATE_INTERVAL);
    } catch (error) {
      console.error("Error while processing task", error);
      await sleep(HEARTBEAT_UPDATE_INTERVAL);
    }
  }
}

await main();
