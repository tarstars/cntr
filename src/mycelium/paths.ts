import path from "node:path"

/** Layout of a workspace's `.mycelium/` directory. Every Mycelium file path comes from here. */
export const myceliumDir = (cwd: string) => path.join(cwd, ".mycelium")
export const taskDir = (cwd: string, taskId: string) => path.join(myceliumDir(cwd), "tasks", taskId)
export const checkRunsDir = (cwd: string) => path.join(myceliumDir(cwd), "check_runs")
export const screenshotsDir = (cwd: string, taskId: string) => path.join(myceliumDir(cwd), "screenshots", taskId)
export const handoffsDir = (cwd: string) => path.join(myceliumDir(cwd), "handoffs")
export const profileFile = (cwd: string) => path.join(myceliumDir(cwd), "profile.json")
export const nextTaskFile = (cwd: string) => path.join(myceliumDir(cwd), "next_task.json")
export const commandRulesFile = (cwd: string) => path.join(myceliumDir(cwd), "command_safety.json")
export const modelsFile = (cwd: string) => path.join(myceliumDir(cwd), "models.json")
export const indexFile = (cwd: string) => path.join(myceliumDir(cwd), "index.json")
