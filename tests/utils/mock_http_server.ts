import { createServer, Server } from 'http'
import { AddressInfo } from 'net'

export class MockHttpServer {
  private server: Server
  private port: number = 0
  private responses: Map<string, { status: number; body: string; headers?: Record<string, string> }> = new Map()

  constructor() {
    this.server = createServer((req, res) => {
      const url = req.url || '/'
      const response = this.responses.get(url) || { status: 200, body: '<html><body>Mock Response</body></html>' }
      
      // Set default headers
      res.setHeader('Content-Type', 'text/html')
      if (response.headers) {
        Object.entries(response.headers).forEach(([key, value]) => {
          res.setHeader(key, value)
        })
      }
      
      res.statusCode = response.status
      res.end(response.body)
    })
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, 'localhost', () => {
        const address = this.server.address() as AddressInfo
        this.port = address.port
        resolve(this.port)
      })
      
      this.server.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve()
      })
    })
  }

  setResponse(path: string, status: number, body: string, headers?: Record<string, string>) {
    this.responses.set(path, { status, body, headers })
  }

  getUrl(): string {
    return `http://localhost:${this.port}`
  }

  getPort(): number {
    return this.port
  }
}

// Global mock server instance for tests
let globalMockServer: MockHttpServer | null = null

export async function startMockServer(): Promise<MockHttpServer> {
  if (globalMockServer) {
    return globalMockServer
  }
  
  globalMockServer = new MockHttpServer()
  await globalMockServer.start()
  
  // Set up default responses
  globalMockServer.setResponse('/', 200, '<html><head><title>Test Page</title></head><body><h1>Test Page</h1></body></html>')
  globalMockServer.setResponse('/not-found', 404, '<html><body>Not Found</body></html>')
  globalMockServer.setResponse('/slow', 200, '<html><body>Slow Response</body></html>')
  
  return globalMockServer
}

export async function stopMockServer(): Promise<void> {
  if (globalMockServer) {
    await globalMockServer.stop()
    globalMockServer = null
  }
}

export function getMockServerUrl(): string {
  if (!globalMockServer) {
    throw new Error('Mock server not started')
  }
  return globalMockServer.getUrl()
}
