// Import necessary modules and initialize environment variables
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import axios from "axios";
import WebSocket from "ws";
import cors from "cors";

import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";

import { Readable } from "stream";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

const basicAuth =
  "Basic " +
  Buffer.from(
    `${process.env.COMFY_WEB_USER}:${process.env.COMFY_WEB_PASSWORD}`
  ).toString("base64");

let comfyWebSocket: WebSocket | null = null; // This will hold our WebSocket connection

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const isValidHttpUrl = (string: string): boolean => {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

function determineMimeType(fileName: string): string {
  const extension = fileName.split(".").pop();
  const mimeTypeMap: { [key: string]: string } = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
  };
  return (
    mimeTypeMap[extension?.toLowerCase() || ""] || "application/octet-stream"
  );
}

const downloadAndUploadImage = async (
  imageUrl: string,
  serverAddress: string,
  imageType: string = "input",
  overwrite: boolean = true
): Promise<any> => {
  const response = await axios({ url: imageUrl, responseType: "arraybuffer" });
  const url = new URL(imageUrl);
  const fileName = url.pathname.split("/").pop() || "default_name.png";
  const imageBuffer = Buffer.from(response.data);
  const mimeType = determineMimeType(fileName);
  const file = new File([imageBuffer], fileName, { type: mimeType });
  const formData = new FormData();
  formData.append("image", file);
  formData.append("type", imageType);
  formData.append("overwrite", overwrite.toString());
  const encoder = new FormDataEncoder(formData);
  const uploadResponse = await axios.post(
    `${serverAddress}/upload/image`,
    Readable.from(encoder.encode()),
    { headers: { ...encoder.headers } }
  );
  return uploadResponse.data;
};

const processInput = async (input: {
  [key: string]: string;
}): Promise<{ [key: string]: string }> => {
  const processedInput = { ...input };
  for (const key in processedInput) {
    if (isValidHttpUrl(processedInput[key])) {
      const resp = await downloadAndUploadImage(
        processedInput[key],
        process.env.COMFY_URL as string
      );
      processedInput[key] = resp.name;
    }
  }
  return processedInput;
};

const mapWorkflowValues = (
  workflow: any,
  workflowValues: { [key: string]: string }
): any => {
  const w = JSON.stringify(workflow);
  return JSON.parse(
    w.replace(/\{\{(\w+)\}\}/g, (match, key) =>
      Object.prototype.hasOwnProperty.call(workflowValues, key)
        ? workflowValues[key]
        : match
    )
  );
};

const trackProgress = async (promptId: string) => {
  return new Promise<void>((resolve) => {
    const comfyWsUrl = `${process.env.COMFY_URL}/ws`;
    if (!comfyWsUrl) throw new Error("Missing Comfy WS URL");
    const client = new WebSocket(comfyWsUrl, {
      headers: { Authorization: basicAuth },
    });
    client.on("message", (data, isBinary) => {
      if (!isBinary) {
        const wsData = JSON.parse(data.toString());
        if (
          (wsData.type === "progress" &&
            wsData.data.prompt_id === promptId &&
            wsData.data.value === wsData.data.max) ||
          (wsData.type === "status" &&
            wsData.data.status.exec_info.queue_remaining === 0)
        ) {
          console.log("Prompt generation complete");
          client.close();
          resolve();
        }
      }
    });
  });
};

async function fetchImagesFromHistory(promptId: string): Promise<string[]> {
  try {
    const OUTPUT_NODE_ID = "14"; // Node ID that contains the generated image outputs
    const historyResponse = await axios.get(
      `${process.env.COMFY_URL}/history/${promptId}`,
      { headers: { Authorization: basicAuth } }
    );
    const historyData =
      historyResponse.data[promptId].outputs[OUTPUT_NODE_ID].images;
    if (!historyData?.length) throw new Error("No history data available");
    return Promise.all(
      historyData.map((item: { filename: string; subfolder: string }) =>
        fetchImage(item.filename, item.subfolder, "output")
      )
    );
  } catch (error) {
    console.error("Error fetching images from history:", error);
    throw error;
  }
}

async function fetchImage(
  filename: string,
  subfolder: string,
  folderType: string
): Promise<string> {
  try {
    const params = new URLSearchParams({
      filename,
      subfolder,
      type: folderType,
    }).toString();
    const response = await axios.get(
      `${process.env.COMFY_URL}/view?${params}`,
      {
        responseType: "arraybuffer",
        headers: { Authorization: basicAuth },
      }
    );
    return Buffer.from(response.data).toString("base64");
  } catch (error) {
    console.error("Error fetching an image:", error);
    throw error;
  }
}

const initializeWebSocketConnection = () => {
  const wsUrl = `${process.env.COMFY_URL}/ws`;
  comfyWebSocket = new WebSocket(wsUrl, {
    headers: { Authorization: basicAuth },
  });
  comfyWebSocket.on("open", () =>
    console.log("Connected to ComfyUI WebSocket server.")
  );
  comfyWebSocket.on("close", () => {
    console.log("WebSocket connection closed. Attempting to reconnect...");
    setTimeout(initializeWebSocketConnection, 10000);
  });
  comfyWebSocket.on("error", (error) => {
    console.error("WebSocket connection error:", error);
  });
};

initializeWebSocketConnection();

app.post("/generate", async (req: Request, res: Response) => {
  const { workflow, workflowValues } = req.body;
  if (!workflow || !workflowValues) {
    return res.status(400).send("Missing workflow or workflowValues");
  }
  try {
    const processedWorkflowValues = await processInput(workflowValues);
    const prompt = mapWorkflowValues(workflow, processedWorkflowValues);
    const resp = await axios.post(
      `${process.env.COMFY_URL}/prompt`,
      { prompt },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: basicAuth,
        },
      }
    );
    await trackProgress(resp.data.prompt_id);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const historyImages = await fetchImagesFromHistory(resp.data.prompt_id);
    res.send({ base64Img: historyImages[0] });
  } catch (error) {
    console.error(error);
    res.status(500).send(`Error generating comfy: ${error}`);
  }
});

app.get("/", (_req, res) => {
  res.send("ComfyUI Proxy Server is running!");
});

app.get("/available", (_req, res) => {
  const isAvailable =
    comfyWebSocket !== null && comfyWebSocket.readyState === WebSocket.OPEN;
  res.status(200).json({ available: isAvailable });
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
