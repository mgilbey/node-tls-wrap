"use strict";
const util = require("util");
const v8 = require("v8");
const tls = require("tls");
const https = require("https");
const fs = require("fs");

class TestServer {
  constructor() {
    this.response = "HTTP/1.1 200 OK\r\n" +
      "Connection: keep-alive\r\n" +
      "Content-Length: 1\r\n" +
      "Content-Type: text/plain\r\n\r\n!";
    this.server = tls.createServer({
      key: fs.readFileSync("certs/localhost-key.pem"),
      cert: fs.readFileSync("certs/localhost-cert.pem")
    }, socket => {
      console.log(`server: incoming connection ${socket.remotePort}`);
      socket.on("data", chunk => {
        console.log(`server: chunk on ${socket.remotePort}: size: ${chunk.length}`);
        setTimeout(() => socket.write(this.response), 1000);
      });
      socket.on("end", () => {
        console.log(`server: connection end ${socket.remotePort}`);
      });
    });
    this.server.on("error", error => {
      console.log(`server: error: ${error}`);
      console.dir(error);
    });
    this.server.listen(2000, () => {
      console.log("server: listening on port 2000");
    });
  }

  close() {
    return new Promise(resolve => this.server.close(resolve));
  }
}

class TestClient {
  constructor() {
    this.agent = new https.Agent({
      keepAlive: true,
      timeout: 3000,
      maxSockets: 150,
      maxFreeSockets: 256,
      maxCachedSessions: 100
    });
    this.requestOptions = {
      agent: this.agent,
      timeout: 2000,
      protocol: "https:",
      hostname: "localhost",
      port: 2000,
      ca: fs.readFileSync("certs/localhost-cert.pem")
    };
  }

  sendRequest() {
    return new Promise((resolve, reject) => {
      const clientRequest = https.request(this.requestOptions, response => {
        response.setEncoding("utf8");
        let received = "";
        let chunkCount = 0;
        response.on("data", chunk => {
          received += chunk;
          chunkCount += 1;
        });
        response.on("end", () => {
          console.log(`client: end: chunks: ${chunkCount}`);
          resolve(received);
        });
      });
      clientRequest.on("error", error => {
        console.log(`client: error: ${error}`);
        reject(error);
      });
      clientRequest.on("timeout", () => {
        console.log(`client: timeout`);
        clientRequest.destroy(new Error("custom timeout"));
      });
      clientRequest.end();
    });
  }

  inspect(description, arg) {
    const count = Object.keys(arg).flatMap(key => arg[key]).length;
    console.log(`${description}: ${util.inspect(count, true, 0)}`);
  }

  logSockets() {
    this.inspect("requests", this.agent.requests);
    this.inspect("freeSockets", this.agent.freeSockets);
    this.inspect("sockets", this.agent.sockets);
  }

  close() {
    this.agent.destroy();
  }
}

class TestRun {
  constructor() {
    this.server = new TestServer();
    this.client = new TestClient();
  }

  async sendUserRequests() {
    await this.client.sendRequest();
    await this.client.sendRequest();
  }

  async sendRequestSet() {
    const requestsDone = [];
    for (let i = 0; i < 100; i++) {
      requestsDone.push(this.sendUserRequests());
    }
    this.client.logSockets();
    await Promise.all(requestsDone);
    this.client.logSockets();
    // let keep alive timeout close connections
    await new Promise(resolve => setTimeout(resolve, 5000));
    this.client.logSockets();
  }

  async run() {
    for (let i = 0; i < 5; i++) {
      await this.sendRequestSet();
    }
    this.client.close();
    await this.server.close();
  }
}

new TestRun().run().catch(console.dir).then(() => {
  if (global.gc) {
    global.gc();
    console.log("collected garbage");
  }
  v8.writeHeapSnapshot();
});
