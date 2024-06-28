const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const axios = require("axios");

// Load environment variables from .env file
dotenv.config();

// Load the workflow and input values
const workflow = require("./comfy_img2img_api.json");
const workflowValues = {
  seed: Math.round(Math.random() * 999999),
  prompt: "A beautiful sunset over the ocean",
  input_image:
    "https://fastly.picsum.photos/id/141/512/512.jpg?hmac=zX9MZomhjOFIpQCXb22lw-dnjJdM_YnzWGq8zJPxlhQ",
};

const generateImage = async () => {
  try {
    const proxyUrl = "http://localhost:5555/generate";
    const response = await axios.post(
      proxyUrl,
      {
        workflow,
        workflowValues,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Get the base64 image from the response
    const base64Img = response.data.base64Img;
    const imgBuffer = Buffer.from(base64Img, "base64");

    // Save the image to the disk
    const outputPath = path.join(__dirname, "output.jpg");
    fs.writeFileSync(outputPath, imgBuffer);

    console.log(`Image saved to ${outputPath}`);
  } catch (error) {
    console.error("Error generating image:", error);
  }
};

// Invoke the function to generate the image
generateImage();
