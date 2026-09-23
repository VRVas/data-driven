import path from "node:path";

export const dataDirectory = (): string => path.resolve(process.env.APP_DATA_DIR ?? path.join(process.cwd(), ".data"));