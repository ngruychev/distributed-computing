import express from "express";
import type { RedisClientType } from "redis";

import { addTask, claimTask, getStats, heartbeat } from "./actions.ts";

interface ApiControllerOptions {
  /**
   * To use in actions
   */
  redisClient: RedisClientType;
}

export function apiController({ redisClient }: ApiControllerOptions): express.Router {
  const router = express.Router();
  router.post("/task", async (req, res) => {
    const task = req.body;
    try {
      await addTask(task, redisClient);
      res.status(200).send("OK");
    } catch {
      res.status(500).send("Internal Server Error");
    }
  });
  router.post("/task/claim", async (req, res) => {
    const claimReq = req.body;
    try {
      const claimed = await claimTask(claimReq, redisClient);
      res.status(200).json(claimed);
    } catch {
      res.status(500).send("Internal Server Error");
    }
  });
  router.post("/task/heartbeat", async (req, res) => {
    // Figure it out
    const beat = req.body;
    const resp = await heartbeat(beat, redisClient);
    if (!resp.success) {
      res.status(500).send("Internal Server Error");
      return;
    }
    res.status(200).json(resp);
  });

  router.get("/stats", async (_, res) => {
    try {
      const stats = await getStats(redisClient);
      res.status(200).json(stats);
    } catch {
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
}
