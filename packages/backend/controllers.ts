import type { Response } from "express";
import express from "express";
import type { RedisClientType } from "redis";

import { addTask, claimSubTask, getAllTasks, getStats, getSubTask, getTask, getTaskInfo, heartbeat, sendAnswer } from "./actions.ts";
import { ZodError } from "zod";

interface ApiControllerOptions {
  /**
   * To use in actions
   */
  redisClient: RedisClientType;
}

function handleError(res: Response, e: unknown) {
  console.error(e);
  if (e instanceof ZodError) {
    res.status(400).json(e.errors);
    return;
  }
  res.status(500).send("Internal Server Error");
}

export function apiController({ redisClient }: ApiControllerOptions): express.Router {
  const router = express.Router();
  router.post("/task", (req, res) => {
    const task = req.body;
    addTask(task, redisClient)
      .then(() => res.status(200).send("OK"))
      .catch((e) => handleError(res, e));
  });
  router.post("/task/claim", (req, res) => {
    const claimReq = req.body;
    claimSubTask(claimReq, redisClient)
      .then((claimed) => {
        console.log(new Date(), "Claimed subtask", JSON.stringify(claimed));
        res.status(200).json(claimed);
      })
      .catch((e) => handleError(res, e));
  });
  router.post("/task/heartbeat", (req, res) => {
    // Figure it out
    const beat = req.body;
    heartbeat(beat, redisClient)
      .then((resp) => {
        if (!resp.success) {
          res.status(400).send("Heartbeat failed");
          return;
        }
        res.status(200).json(resp);
      })
      .catch((e) => handleError(res, e));
  });

  router.get("/task", (_, res) => {
    getAllTasks(redisClient)
      .then((tasks) => res.status(200).json(tasks))
      .catch((e) => handleError(res, e));
  });

  router.post("/task/answer", (req, res) => {
    const answer = req.body;
    sendAnswer(answer, redisClient)
      .then((answer) => res.status(200).json(answer))
      .catch((e) => handleError(res, e));
  });


  router.get("/task/:id", (req, res) => {
    const { id } = req.params;
    getTask(id, redisClient)
      .then((task) => {
        if (task === null) {
          res.status(404).send("Not Found");
          return;
        }
        res.status(200).json(task);
      })
      .catch((e) => handleError(res, e));
  });
  router.get("/task/:id/info", (req, res) => {
    const { id } = req.params;
    getTaskInfo(id, redisClient)
      .then((task) => {
        if (task === null) {
          res.status(404).send("Not Found");
          return;
        }
        res.status(200).json(task);
      })
      .catch((e) => handleError(res, e));
  });
  router.get("/task/:id/subtask/:idx", (req, res) => {
    const { id, idx } = req.params;
    getSubTask(id, idx, redisClient)
      .then((subtask) => {
        if (subtask === null) {
          res.status(404).send("Not Found");
          return;
        }
        res.status(200).json(subtask);
      })
      .catch((e) => handleError(res, e));
  });

  router.get("/stats", (_, res) => {
    getStats(redisClient)
      .then((stats) => res.status(200).json(stats))
      .catch((e) => handleError(res, e));
  });

  return router;
}
