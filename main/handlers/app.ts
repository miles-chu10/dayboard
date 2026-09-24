import { app, logger } from "@glaze/core/backend";

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
