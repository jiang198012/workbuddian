import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { AcpClient, type AcpClientEvents } from '../src/providers/acp/client';

type Rpc = { id: number; method: string; params: Record<string, any> };

/** An external sidecar executes the actual public client's command without a system Node. */
describe('WorkBuddy existing sidecar without system Node', () => {
    let root: string;
    let client: AcpClient | undefined;
    let server: net.Server | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let childExit: Promise<void> | undefined;
    let created: Rpc['params'] | undefined;
    let spawnError: string | undefined;
    const sockets = new Set<net.Socket>();
    const saved = new Map<string, string | undefined>();
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    const hash = (value: string, length: number) => createHash('sha1').update(value).digest('hex').slice(0, length);

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync('/tmp/wbnn-'));
        for (const key of ['HOME', 'LOCALAPPDATA', 'WORKBUDDY_CONFIG_DIR', 'CODEBUDDY_PATH', 'NVM_BIN']) saved.set(key, process.env[key]);
        process.env.HOME = path.join(root, 'home');
        process.env.WORKBUDDY_CONFIG_DIR = path.join(root, 'config');
        delete process.env.CODEBUDDY_PATH;
        delete process.env.NVM_BIN;
        Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
        jest.spyOn(require('os'), 'tmpdir').mockReturnValue(root);
        const actualFs = jest.requireActual<typeof fs>('fs');
        const existsSync = actualFs.existsSync;
        const statSync = actualFs.statSync;
        jest.spyOn(require('fs'), 'existsSync').mockImplementation((file: fs.PathLike) =>
            String(file).startsWith('/Applications/WorkBuddy.app/') ? false : existsSync(file));
        jest.spyOn(require('fs'), 'statSync').mockImplementation((file: fs.PathLike, options?: any) => {
            if (['node', 'node.exe'].includes(path.basename(String(file)))) {
                throw Object.assign(new Error('No system Node in this fixture'), { code: 'ENOENT' });
            }
            return statSync(file, options);
        });
    });

    afterEach(async () => {
        client?.dispose();
        if (child && child.exitCode === null) child.kill('SIGTERM');
        await childExit;
        for (const socket of sockets) socket.destroy();
        if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
        client = undefined; server = undefined; child = undefined; childExit = undefined;
        created = undefined; spawnError = undefined; sockets.clear();
        jest.restoreAllMocks();
        Object.defineProperty(process, 'platform', platform);
        for (const [key, value] of saved) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        saved.clear();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it.each([
        { targetPlatform: 'darwin', linked: false },
        { targetPlatform: 'win32', linked: false },
        { targetPlatform: 'darwin', linked: true },
    ])('automatically initializes through the installed desktop runtime with an existing sidecar on $targetPlatform (linked=$linked)', async ({ targetPlatform, linked }) => {
        Object.defineProperty(process, 'platform', { configurable: true, value: targetPlatform });
        process.env.LOCALAPPDATA = process.env.HOME;
        const appRoot = targetPlatform === 'darwin'
            ? path.join(linked ? path.join(root, 'custom') : path.join(process.env.HOME!, 'Applications'), 'WorkBuddy.app', 'Contents')
            : path.join(process.env.HOME!, 'Programs', 'WorkBuddy');
        const cliRoot = path.join(appRoot, 'Resources', 'app.asar.unpacked', 'cli');
        const scriptPath = path.join(cliRoot, 'bin', 'codebuddy');
        const discoveredPath = linked ? path.join(process.env.HOME!, '.local', 'bin', 'codebuddy')
            : targetPlatform === 'darwin' ? scriptPath : `${scriptPath}.cmd`;
        const electron = targetPlatform === 'darwin' ? path.join(appRoot, 'MacOS', 'Electron') : path.join(appRoot, 'WorkBuddy.exe');
        const cwd = path.join(root, 'vault');
        fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
        fs.mkdirSync(path.dirname(electron), { recursive: true });
        fs.mkdirSync(path.join(cliRoot, 'dist'));
        fs.mkdirSync(cwd);
        fs.mkdirSync(process.env.WORKBUDDY_CONFIG_DIR!);
        fs.copyFileSync(path.join(__dirname, 'helpers/workbuddy-native-cli.cjs'), scriptPath);
        if (linked) {
            fs.mkdirSync(path.dirname(discoveredPath), { recursive: true });
            fs.symlinkSync(scriptPath, discoveredPath);
        }
        if (targetPlatform === 'win32') fs.writeFileSync(discoveredPath, 'fixture wrapper must not run as the Node entry');
        // The fixture runtime runs real Node code; it is not found as a system node candidate.
        fs.symlinkSync(process.execPath, electron);
        fs.writeFileSync(path.join(cliRoot, 'product.json'), JSON.stringify({ productName: 'WorkBuddy' }));
        fs.writeFileSync(path.join(cliRoot, 'dist', 'codebuddy-lite-wb.mjs'), 'CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET');
        const runtimeDir = path.join(root, `wb-${hash(String(process.getuid!()), 6)}`, hash(process.env.WORKBUDDY_CONFIG_DIR!, 12));
        const socketPath = path.join(runtimeDir, 'sidecar-1234abcd.sock');
        if (targetPlatform === 'win32') {
            // This machine has Unix sockets: adapt only the external named-pipe transport boundary.
            const pipe = `\\\\.\\pipe\\workbuddy-${hash(process.env.WORKBUDDY_CONFIG_DIR!, 12)}-sidecar-control-1234abcd`;
            const createConnection = net.createConnection;
            jest.spyOn(require('net'), 'createConnection').mockImplementation((address: any, ...rest: any[]) =>
                (createConnection as any)(address === pipe ? socketPath : address, ...rest));
        }
        fs.mkdirSync(runtimeDir, { recursive: true });
        fs.writeFileSync(path.join(runtimeDir, 'sidecar.pid'), JSON.stringify({ pid: process.pid, version: 6, controlPipeUuid: '1234abcd' }));
        server = net.createServer(socket => {
            sockets.add(socket); socket.on('close', () => sockets.delete(socket));
            socket.setEncoding('utf8');
            let buffer = '';
            const reply = (request: Rpc, result?: unknown, error?: unknown) => {
                if (!socket.destroyed) socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(error ? { error } : { result }) }) + '\n');
            };
            socket.on('data', chunk => {
                buffer += chunk;
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const request = JSON.parse(buffer.slice(0, newline)) as Rpc;
                    buffer = buffer.slice(newline + 1);
                    if (request.method === 'session.kill') {
                        if (child && child.exitCode === null) child.kill('SIGTERM');
                        reply(request, { ok: true });
                    } else if (request.method === 'session.create') {
                        created = request.params;
                        // No PATH fallback: only a concrete installed runtime can start this worker.
                        child = spawn(request.params.command, request.params.args, {
                            cwd: request.params.cwd, env: { ...request.params.env, PATH: '' }, stdio: ['ignore', 'pipe', 'pipe'],
                        });
                        childExit = new Promise<void>(resolve => child!.once('close', () => resolve()));
                        child.once('error', (error: NodeJS.ErrnoException) => {
                            spawnError = error.code;
                            reply(request, undefined, { code: -32000, message: 'worker executable unavailable' });
                        });
                        child.stderr!.on('data', () => {});
                        let stdout = '';
                        child.stdout!.on('data', chunk => {
                            stdout += chunk.toString();
                            const endpoint = /Endpoint\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)?.[1];
                            if (endpoint) reply(request, {
                                sessionId: request.params.sessionId, runtimeId: 'external-runtime', pid: child!.pid,
                                acpEndpoint: `${endpoint}/api/v1/acp`,
                            });
                        });
                    }
                }
            });
        });
        await new Promise<void>(resolve => server!.listen(socketPath, resolve));
        const events: AcpClientEvents = {
            onSessionUpdate: jest.fn(), onPermissionRequest: jest.fn(), onAgentNotification: jest.fn(),
            onModels: jest.fn(), onExit: jest.fn(),
        };
        client = new AcpClient(events);
        expect(client.getScriptPath()).toBe(discoveredPath);
        await expect(client.ensureStarted(cwd).catch(error => {
            throw new Error(`${error.message}; fixture command=${created?.command}; spawn errno=${spawnError}`);
        })).resolves.toBeUndefined();
        expect(spawnError).toBeUndefined();
        expect(created).toMatchObject({ command: electron, args: [scriptPath, '--serve'] });
        expect(client.running).toBe(true);
        await expect(client.request('session/new', { cwd, mcpServers: [] })).resolves.toEqual({ sessionId: 'fixture-owned' });
    });
});
