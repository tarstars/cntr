import * as os from "os"
import * as path from "path"

/** Mycelium's global data directory: $MYCELIUM_DIR, else ~/.mycelium (never Cline's ~/.cline). */
export function myceliumHome(): string {
	return process.env.MYCELIUM_DIR || path.join(os.homedir(), ".mycelium")
}

/**
 * Base URL used in place of Cline's cloud services. Port 9 (discard) on loopback is closed on
 * normal machines, so any leftover call fails locally and nothing leaves the computer.
 */
export const DISABLED_CLOUD_URL = "http://127.0.0.1:9"
