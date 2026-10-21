import { moment as obsidianMoment } from "obsidian";

// Obsidian's namespace import loses Moment's call signatures with esModuleInterop.
export const moment = obsidianMoment as typeof obsidianMoment &
  typeof obsidianMoment.utc;
