import type { Command } from "commander";
import { green } from "@std/fmt/colors";
import { withCommandError } from "./resource-helpers.ts";
import {
  buildOptionalQuery,
  printNamedResourceApiResponse,
  readTextValue,
  requestNamedResourceApi,
  type ResourceCommandOptions,
  type ResourceJsonCommandOptions,
  type StoreCommandSpec,
  type StorePutOptions,
} from "./resource-core.ts";

type StoreListOptions = ResourceJsonCommandOptions & { prefix?: string };

function registerNamedEntryCommands(
  parent: Command,
  config: StoreCommandSpec,
): void {
  parent
    .command("ls <name>")
    .option("--prefix <prefix>", `${config.noun} prefix`)
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        config.listError,
        async (name: string, options: StoreListOptions) => {
          await printNamedResourceApiResponse(
            name,
            options,
            `${config.pathPrefix}${
              buildOptionalQuery("prefix", options.prefix)
            }`,
          );
        },
      ),
    );

  parent
    .command("get <name> <key>")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        config.readError,
        async (
          name: string,
          key: string,
          options: ResourceJsonCommandOptions,
        ) => {
          await printNamedResourceApiResponse(
            name,
            options,
            `${config.pathPrefix}/${encodeURIComponent(key)}`,
          );
        },
      ),
    );

  const putCommand = parent
    .command("put <name> <key>")
    .option("--value <value>", "Literal value")
    .option("--file <path>", "Read value from file")
    .option("--space <id>", "Target workspace ID");
  if (config.includeContentType) {
    putCommand.option("--content-type <type>", "Content type");
  }

  putCommand.action(
    withCommandError(
      config.writeError,
      async (name: string, key: string, options: StorePutOptions) => {
        const value = await readTextValue(options);
        await requestNamedResourceApi(
          name,
          options,
          `${config.pathPrefix}/${encodeURIComponent(key)}`,
          {
            method: "PUT",
            body: {
              value,
              ...(config.includeContentType
                ? { content_type: options.contentType }
                : {}),
            },
          },
        );
        console.log(green(config.writeSuccess(name, key)));
      },
    ),
  );

  parent
    .command("rm <name> <key>")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        config.deleteError,
        async (name: string, key: string, options: ResourceCommandOptions) => {
          await requestNamedResourceApi(
            name,
            options,
            `${config.pathPrefix}/${encodeURIComponent(key)}`,
            { method: "DELETE" },
          );
          console.log(green(config.deleteSuccess(name, key)));
        },
      ),
    );
}

export function registerSqlCommands(resourceCmd: Command) {
  const sqlCmd = resourceCmd.command("sql").description(
    "Operate on SQL resources",
  );

  sqlCmd
    .command("tables <name>")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to list tables",
        async (name: string, options: ResourceJsonCommandOptions) => {
          await printNamedResourceApiResponse(name, options, "/sql/tables");
        },
      ),
    );

  sqlCmd
    .command("query <name> <sql>")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to run query",
        async (
          name: string,
          sql: string,
          options: ResourceJsonCommandOptions,
        ) => {
          await printNamedResourceApiResponse(name, options, "/sql/query", {
            method: "POST",
            body: { sql },
          });
        },
      ),
    );
}

export function registerObjectCommands(resourceCmd: Command) {
  const objectCmd = resourceCmd.command("object").description(
    "Operate on object-store resources",
  );

  registerNamedEntryCommands(objectCmd, {
    noun: "Object",
    pathPrefix: "/objects",
    listError: "Failed to list objects",
    readError: "Failed to read object",
    writeError: "Failed to store object",
    deleteError: "Failed to delete object",
    writeSuccess: (_name, key) => `Stored object '${key}'.`,
    deleteSuccess: (_name, key) => `Deleted object '${key}'.`,
    includeContentType: true,
  });
}

export function registerKvCommands(resourceCmd: Command) {
  const kvCmd = resourceCmd.command("kv").description(
    "Operate on KV resources",
  );

  registerNamedEntryCommands(kvCmd, {
    noun: "Key",
    pathPrefix: "/kv/entries",
    listError: "Failed to list KV entries",
    readError: "Failed to read KV entry",
    writeError: "Failed to store KV entry",
    deleteError: "Failed to delete KV entry",
    writeSuccess: (_name, key) => `Stored KV entry '${key}'.`,
    deleteSuccess: (_name, key) => `Deleted KV entry '${key}'.`,
  });
}
