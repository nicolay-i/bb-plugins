import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const hostContract = defineRpcContract({
  fileVersion: {
    input: z.object({ path: z.string().min(1).max(32768) }).strict(),
    output: z.string().nullable(),
  },
});
