import { app } from "electron";
import { configureUserData } from "./user-data.js";

try {
  configureUserData();
} catch (error) {
  app.exit(1);
  throw error;
}
