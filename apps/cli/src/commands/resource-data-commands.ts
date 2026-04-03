import { green } from "@std/fmt/colors";
import type { Command } from "commander";
import { withCommandError } from "./resource-helpers.ts";
import {
  buildOptionalQuery,
  printNamedResourceApiResponse,
  readTextValue,
  requestNamedResourceApi,
  type StoreCommandSpec,
  type StorePutOptions,
} from "./resource-shared.ts";

function registerStoreCommands(resourceCmd: Command, spec: StoreCommandSpec) {
  const storeCmd = resourceCmd.command(spec.name).description(spec.description);

  storeCmd
    .command("ls <name>")
    .option("--prefix <prefix>", spec.listOptionDescription)
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        spec.listErrorMessage,
        async (
          name: string,
          options: { prefix?: string; space?: string; json?: boolean },
        ) => {
          await printNamedResourceApiResponse(
            name,
            options,
            `${spec.collectionPath}${
              buildOptionalQuery("prefix", options.prefix)
            }`,
          );
        },
      ),
    );

  storeCmd
    .command("get <name> <key>")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        spec.getErrorMessage,
        async (
          name: string,
          key: string,
          options: { space?: string; json?: boolean },
        ) => {
          await printNamedResourceApiResponse(
            name,
            options,
            `${spec.collectionPath}/${encodeURIComponent(key)}`,
          );
        },
      ),
    );

  storeCmd
    .command("put <name> <key>")
    .option("--value <value>", spec.putValueDescription)
    .option("--file <path>", spec.putFileDescription)
    .option("--content-type <type>", "Content type")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        spec.putErrorMessage,
        async (name: string, key: string, options: StorePutOptions) => {
          const value = await readTextValue(options);
          await requestNamedResourceApi(
            name,
            options,
            `${spec.collectionPath}/${encodeURIComponent(key)}`,
            {
              method: "PUT",
              body: spec.putBody(value, options),
            },
          );
          console.log(green(`Stored ${spec.itemLabel} '${key}' in '${name}'.`));
        },
      ),
    );

  storeCmd
    .command("rm <name> <key>")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        spec.deleteErrorMessage,
        async (name: string, key: string, options: { space?: string }) => {
          await requestNamedResourceApi(
            name,
            options,
            `${spec.collectionPath}/${encodeURIComponent(key)}`,
            { method: "DELETE" },
          );
          console.log(
            green(`Deleted ${spec.itemLabel} '${key}' from '${name}'.`),
          );
        },
      ),
    );
}

function registerSqlCommands(resourceCmd: Command) {
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
        async (name: string, options: { space?: string; json?: boolean }) => {
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
          options: { space?: string; json?: boolean },
        ) => {
          await printNamedResourceApiResponse(name, options, "/sql/query", {
            method: "POST",
            body: { sql },
          });
        },
      ),
    );
}

export function registerResourceDataCommands(resourceCmd: Command): void {
  registerSqlCommands(resourceCmd);

  registerStoreCommands(resourceCmd, {
    name: "object",
    description: "Operate on object-store resources",
    itemLabel: "object",
    collectionPath: "/objects",
    listErrorMessage: "Failed to list objects",
    getErrorMessage: "Failed to read object",
    putErrorMessage: "Failed to store object",
    deleteErrorMessage: "Failed to delete object",
    listOptionDescription: "Object prefix",
    putValueDescription: "Literal object contents",
    putFileDescription: "Read object contents from file",
    putBody: (value, options) => ({
      value,
      content_type: options.contentType,
    }),
  });

  registerStoreCommands(resourceCmd, {
    name: "kv",
    description: "Operate on KV resources",
    itemLabel: "KV entry",
    collectionPath: "/kv/entries",
    listErrorMessage: "Failed to list KV entries",
    getErrorMessage: "Failed to read KV entry",
    putErrorMessage: "Failed to store KV entry",
    deleteErrorMessage: "Failed to delete KV entry",
    listOptionDescription: "Key prefix",
    putValueDescription: "Literal value",
    putFileDescription: "Read value from file",
    putBody: (value) => ({ value }),
  });
}
