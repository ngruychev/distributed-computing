import express from "express";
import type { RedisClientType } from "redis";
import { createClient } from "redis";

import { apiController } from "./controllers.ts";

const app = express();
app.use(express.json());

const redisClient = createClient();

app.use("/api", apiController({ redisClient: redisClient as RedisClientType }));

app.get("/test", (_, res) => {
  res.status(200).send({ status: "OK" });
});

// expose the "public" directory files and folders under the root path, e.g "/index.html" -> "/public/index.html"
app.use(express.static("public"));

app.listen(3000, () => {
  console.log("Listening on 3000");
});