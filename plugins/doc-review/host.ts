import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./src/host-contract.js";
import { fileVersion } from "./src/file-version.js";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: { fileVersion: ({ path }) => fileVersion(path) },
});
