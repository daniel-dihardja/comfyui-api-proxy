# ComfyUI Integration Service

This service is designed to integrate with ComfyUI's API, facilitating the download of images from URLs, uploading them to ComfyUI, and handling various aspects of image processing workflows.

## Features

- **Image Handling**: Downloads images from URLs and uploads them to the ComfyUI server.
- **Workflow Management**: Supports the execution of specific workflows on ComfyUI, including input processing and prompt generation.
- **Progress Tracking**: Utilizes WebSockets to track and report the progress of image processing tasks.
- **Result Retrieval**: Fetches processed images and returns them as base64 encoded strings.

## Getting Started

### Prerequisites

- Node.js
- npm or Yarn
- Access to ComfyUI's API

### Installation

1. Clone the repository to your local machine.
2. Install the necessary dependencies by running:
   ```bash
   npm install
   ```
   or
   ```bash
   yarn install
   ```

### Configuration

- Create a `.env` file in the root of your project directory.
- Add the necessary environment variables:
  ```
  PORT=3000
  COMFY_WEB_USER=<your-comfyui-username>
  COMFY_WEB_PASSWORD=<your-comfyui-password>
  ```

### Running the Server

Execute the following command to start the server:

```bash
npm start
```

or if you are using Yarn:

```bash
yarn start
```

The server will start running on [http://localhost:3000](http://localhost:3000).

## API Endpoints

- `POST /generate`: Triggers a new workflow on ComfyUI with provided workflow values.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
