import { app, logger } from "../platform/index.js";

export const appHandlers = {
  getInfo: async () => {
    logger.info("app", "App info requested");
    return {
      name: "DayBoard",
      version: app.getVersion(),
      environment: process.env.NODE_ENV || "production",
    };
  },
};
