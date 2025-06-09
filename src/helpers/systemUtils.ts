// --- helpers/systemUtils.ts ---
import { spawn } from 'child_process'
import { Socket } from 'socket.io'
import Store from 'electron-store'
import systeminformation from 'systeminformation'
import { getFonts } from 'font-list'
import { EVENTS } from './generalUtils.js'

const store = new Store()
const adminPassword = store.get('password')

export async function getSystemInfo() {
    try {
        const [cpu, currentLoad, memory, networkInterfaces, networkStats, gpu] =
            await Promise.all([
                systeminformation.cpu(),
                systeminformation.currentLoad(),
                systeminformation.mem(),
                systeminformation.networkInterfaces(),
                systeminformation.networkStats(),
                systeminformation.graphics(),
            ])
        return {
            cpu,
            currentLoad,
            memory,
            networkInterfaces,
            networkStats,
            gpu,
        }
    } catch (error) {
        console.error('Error getting system information:', error)
        return null
    }
}

export function runScript(executable: string, args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
        console.log(`Running script: ${executable} ${args.join(' ')}`);

        const isPs1 = executable.toLowerCase().endsWith('.ps1');
        const isSh = executable.toLowerCase().endsWith('.sh');
        const isWindows = process.platform === 'win32';

        let cmd = executable;
        let spawnArgs = args;

        if (isPs1 && isWindows) {
            cmd = 'powershell.exe';
            spawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', executable, ...args];
        } else if (isSh && isWindows) {
            cmd = 'C:\\Program Files\\Git\\bin\\bash.exe'; // Adjust path if needed
            spawnArgs = [executable, ...args];
        }

        const processHandle = spawn(cmd, spawnArgs);
        let output = '', errorOutput = '';

        if (stdin) {
            processHandle.stdin.write(stdin);
            processHandle.stdin.end();
        }

        processHandle.stdout.on('data', (data) => output += data.toString());
        processHandle.stderr.on('data', (data) => errorOutput += data.toString());

        processHandle.on('close', (code) => {
            code === 0
                ? resolve(output)
                : reject(`Error executing script: ${errorOutput}`);
        });

        processHandle.on('error', (err) => reject(`Failed to start process: ${err.message}`));
    });
}

export async function getInstalledFontFamilies(): Promise<string[]> {
    try {
        const fonts = await getFonts()
        return [
            ...new Set(
                fonts.map((f) => f.trim().replace(/^"|"$/g, '')) // ← cleans up extra quotes
            ),
        ].sort()
    } catch (error) {
        console.error('Error listing fonts:', error)
        return []
    }
}

export function runSystemCommand(
    command: string[],
    successMessage: string,
    socket?: Socket
) {
    const proc = spawn(command[0], command.slice(1))

    proc.on('close', (code) => {
        if (socket) {
            socket.emit(
                EVENTS.COMMAND_RESULT,
                code === 0 ? successMessage : 'Error executing command.'
            )
        }
    })

    proc.on('error', (err) => {
        if (socket) {
            socket.emit(
                EVENTS.COMMAND_RESULT,
                `Error during execution: ${err.message}`
            )
        }
    })
}

export function shutdownSystem(minutes: number, socket?: Socket) {
    const platform = process.platform
    const msg = `The system will shut down in ${minutes} minutes.`
    const shutdownCmd =
        platform === 'win32'
            ? ['shutdown', '/s', '/f', '/t', (minutes * 60).toString()]
            : ['sudo', 'shutdown', '-h', `+${minutes}`, msg]

    if (platform !== 'win32') {
        const notifyCmd =
            platform === 'darwin'
                ? [
                      'osascript',
                      '-e',
                      `display notification "${msg}" with title "Shutdown Alert"`,
                  ]
                : ['notify-send', 'Shutdown Alert', msg]
        runSystemCommand(notifyCmd, msg, socket)
    }

    runSystemCommand(shutdownCmd, msg, socket)
}
