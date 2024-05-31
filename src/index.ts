// Import necessary modules and initialize environment variables
import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import axios from "axios";
import path from "path";
import { promises as fs } from "fs";
import WebSocket from "ws";

import { FormData, File } from "formdata-node";
import { fileFromPath } from "formdata-node/file-from-path";
import { FormDataEncoder } from "form-data-encoder";

import { Readable } from "stream";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

/**
 * Checks if a string is a valid URL.
 * @param string The string to check.
 * @returns boolean indicating if the string is a valid URL.
 */
const isValidHttpUrl = (string: string) => {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
};

/**
 * Downloads an image from a URL and uploads it to a server via the ComfyUI upload API.
 * @param imageUrl The URL of the image to download.
 * @param serverAddress The address of the ComfyUI server where the image will be uploaded.
 * @param imageType The type/category of the image being uploaded. Defaults to "input".
 * @param overwrite Whether to overwrite an existing file with the same name. Defaults to false.
 * @returns The server response after the upload.
 */
const downloadAndUploadImage = async (
  imageUrl: string,
  serverAddress: string,
  imageType: string = "input",
  overwrite: boolean = true
): Promise<any> => {
  const response = await axios({
    url: imageUrl,
    responseType: "arraybuffer",
  });

  const fileName = path.basename(new URL(imageUrl).pathname);
  const tempFilePath = path.join("/tmp", fileName);
  await fs.writeFile(tempFilePath, response.data);

  const formData = new FormData();
  const file = await fileFromPath(tempFilePath);
  formData.append("image", file);
  formData.append("type", imageType);
  formData.append("overwrite", overwrite.toString());

  const encoder = new FormDataEncoder(formData);

  const uploadResponse = await axios.post(
    `${serverAddress}/upload/image`,
    Readable.from(encoder),
    {
      headers: encoder.headers,
    }
  );

  await fs.unlink(tempFilePath);

  return uploadResponse.data;
};
/**
 * Processes input objects, downloading images from URLs and saving them locally.
 * @param input The input object with potential URL values.
 * @returns The processed input with URLs replaced by local filenames.
 */
const processInput = async (input: {
  [key: string]: string;
}): Promise<{ [key: string]: string }> => {
  const processedInput = { ...input };
  for (const key in processedInput) {
    const value = processedInput[key];
    if (isValidHttpUrl(value)) {
      const resp = await downloadAndUploadImage(
        value,
        process.env.COMFY_URL as string
      );
      processedInput[key] = resp.name;
    }
  }
  return processedInput;
};

/**
 * Maps workflow values into a template workflow by replacing placeholders.
 * @param workflow The workflow template.
 * @param workflowValues The values to replace into the workflow.
 * @returns The workflow with replaced values.
 */
const mapWorkflowValues = (
  workflow: undefined,
  workflowValues: { [key: string]: string }
) => {
  const w = JSON.stringify(workflow);
  return JSON.parse(
    w.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (Object.prototype.hasOwnProperty.call(workflowValues, key)) {
        return workflowValues[key];
      }
      return match;
    })
  );
};

/**
 * Tracks the progress of a prompt generation via WebSocket.
 * @param promptId The ID of the prompt to track.
 * @returns A promise that resolves when the generation is complete.
 */
const trackProgress = async (promptId: string) => {
  return new Promise<void>((resolve) => {
    const comfyWsUrl = process.env.COMFY_WS_URL;
    if (!comfyWsUrl) {
      throw new Error("Missing Comfy WS URL");
    }
    const client = new WebSocket(comfyWsUrl);
    client.on("message", (data, isBinary) => {
      if (!isBinary) {
        const wsData = JSON.parse(data.toString());
        if (
          wsData.type === "progress" &&
          wsData.data.prompt_id === promptId &&
          wsData.data.value === wsData.data.max
        ) {
          console.log("Prompt generation complete");
          client.close();
          resolve();
        }
      }
    });
  });
};

/**
 * Finds and returns the last image added to a directory as a base64 string.
 * @param directory The directory to search in.
 * @returns The base64 string of the last added image.
 */
const getLastImageAdded = async (directory: string) => {
  try {
    const files = await fs.readdir(directory, { withFileTypes: true });
    const images = files
      .filter((file) => file.isFile())
      .map((file) => ({
        name: file.name,
        path: path.join(directory, file.name),
      }));
    const imageStats = await Promise.all(
      images.map(async (image) => ({
        ...image,
        stats: await fs.stat(image.path),
      }))
    );
    imageStats.sort(
      (a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime()
    );
    if (imageStats.length > 0) {
      const imageData = await fs.readFile(imageStats[0].path);
      return imageData.toString("base64");
    } else {
      throw new Error("No images found in the directory.");
    }
  } catch (error) {
    console.error("Error getting the last added image:", error);
    throw error;
  }
};

/**
 * Endpoint to generate a prompt based on workflow and values.
 */
app.post("/generate", async (req: Request, res: Response) => {
  const workflow = req.body.workflow;
  if (!workflow) {
    return res.status(400).send("Missing workflow");
  }
  const workflowValues = req.body.workflowValues;
  if (!workflowValues) {
    return res.status(400).send("Missing workflowValues");
  }
  try {
    const processedWorkflowValues = await processInput(workflowValues);
    const prompt = mapWorkflowValues(workflow, processedWorkflowValues);
    console.log("Prompt:", prompt);
    const resp = await axios.post(
      process.env.COMFY_PROMPT_URL as string,
      { prompt },
      { headers: { "Content-Type": "application/json" } }
    );
    await trackProgress(resp.data.prompt_id);
    const base64Img = await getLastImageAdded(
      process.env.COMFY_OUTPUT_FOLDER as string
    );
    res.send({ base64Img });
  } catch (error) {
    console.error(error);
    res.status(500).send(`Error generating comfy: ${error}`);
  }
});

// Starts the server
app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
