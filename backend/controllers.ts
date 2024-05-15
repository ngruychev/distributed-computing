import express from "express";
import type { RedisClientType } from "redis";

import { addTask, claimTask, heartbeat } from "./actions.ts";

interface ApiControllerOptions {
  /**
   * To use in actions
   */
  redisClient: RedisClientType;
}

export function apiController({ redisClient }: ApiControllerOptions): express.Router {
  const router = express.Router();
  router.post("/task", (_, res) => {
    // Figure it out
    res.status(501).send("Not Implemented");
  });
  router.post("/task/claim", (_, res) => {
    // Figure it out
    res.status(501).send("Not Implemented");
  });
  router.post("/task/heartbeat", (_, res) => {
    // Figure it out
    res.status(501).send("Not Implemented");
  });

  router.get("/stats", (_, res) => {
    // Figure it out
    res.status(501).send("Not Implemented");
  });

  return router;
}
