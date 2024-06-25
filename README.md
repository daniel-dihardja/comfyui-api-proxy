# ComfyUI Proxy Server

### Introduction

The ComfyUI Proxy Server allows users to interact with the ComfyUI API to automate the generation of AI images. In ComfyUI, a workflow can be saved in an API format, which is then passed to the proxy server. Users can create and save workflows in ComfyUI, and pass these workflows along with custom input parameters to the API via the proxy server.

If custom images are used as input, the proxy server will download these images, upload them to ComfyUI, and update the values in the workflow accordingly. This setup provides flexibility in where to launch the ComfyUI GPU instance, such as starting a GPU instance on RunPod and using the proxy to generate images from the workflow.

This is particularly useful if the process of generating images needs to be automated for bulk generation or if the generation process needs to be integrated into an application.
