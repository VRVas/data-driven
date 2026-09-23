import "server-only";
import type { Database, Container, QueryIterator } from "@azure/cosmos";
import { promises as rawFs } from "node:fs";
import { rawDatabase } from "./backend";
import { withDataset, withLocalFile } from "./control";
import { RecoveryError } from "./package";

export function routedDatabase(database: Database): Database {
  const container = (name: string): Container => {
    const invoke = (method: string, args: unknown[], point?: unknown[]) => withDataset(async (target, signal) => {
      const current = rawDatabase(target)!.container(name);
      const receiver = point ? Reflect.apply(current.item, current, point) : current.items;
      const index = ["create", "upsert", "replace", "patch"].includes(method) ? 1 : 0;
      const parameters = [...args];
      parameters[index] = { ...(parameters[index] as object ?? {}), abortSignal: signal };
      return Reflect.apply(Reflect.get(receiver, method), receiver, parameters);
    });
    const iterator = (method: "readAll" | "query", args: unknown[]) => {
      let selected: string | undefined;
      let actual: QueryIterator<unknown> | undefined;
      const execute = (operation: "fetchAll" | "fetchNext") => withDataset(async (target, signal) => {
        if (selected && selected !== target) throw new RecoveryError("dataset_changed", "The dataset changed. Start a new request.", 409);
        selected = target;
        const items = rawDatabase(target)!.container(name).items;
        const parameters = [...args];
        const index = method === "query" ? 1 : 0;
        parameters[index] = { ...(parameters[index] as object ?? {}), abortSignal: signal };
        actual ??= Reflect.apply(items[method], items, parameters) as QueryIterator<unknown>;
        return actual[operation]();
      });
      return { fetchAll: () => execute("fetchAll"), fetchNext: () => execute("fetchNext"), hasMoreResults: () => actual?.hasMoreResults() ?? true };
    };
    return { id: name, items: { readAll: (...args: unknown[]) => iterator("readAll", args), query: (...args: unknown[]) => iterator("query", args),
      create: (...args: unknown[]) => invoke("create", args), upsert: (...args: unknown[]) => invoke("upsert", args) },
    item: (...point: unknown[]) => ({ read: (...args: unknown[]) => invoke("read", args, point), replace: (...args: unknown[]) => invoke("replace", args, point),
      delete: (...args: unknown[]) => invoke("delete", args, point), patch: (...args: unknown[]) => invoke("patch", args, point) }) } as unknown as Container;
  };
  return new Proxy(database, { get(target, property, receiver) { return property === "container" ? container : Reflect.get(target, property, receiver); } });
}

export const dataFs = new Proxy(rawFs, { get(target, property, receiver) {
  if (["readFile", "writeFile", "unlink", "stat", "access"].includes(String(property))) {
    return (file: unknown, ...args: unknown[]) => typeof file === "string"
      ? withLocalFile(file, async (resolved) => Reflect.apply(Reflect.get(target, property), target, [resolved, ...args]))
      : Reflect.apply(Reflect.get(target, property), target, [file, ...args]);
  }
  return Reflect.get(target, property, receiver);
} });