import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// 1. Inicializar el Servidor MCP nativo
const mcpServer = new Server(
  { name: "gemini-imagen-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 2. Definir la herramienta para Claude
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generar_imagen_gemini",
        description: "Genera imágenes realistas o conceptuales de alta calidad usando Google Imagen 3.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Descripción detallada de la imagen que deseas generar.",
            },
            aspectRatio: {
              type: "string",
              enum: ["1:1", "3:4", "4:3", "16:9"],
              default: "1:1"
            }
          },
          required: ["prompt"],
        },
      },
    ],
  };
});

// 3. Procesar la llamada a la API de Google Imagen
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "generar_imagen_gemini") {
    throw new Error("Herramienta no encontrada");
  }

  const { prompt, aspectRatio = "1:1" } = request.params.arguments;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      content: [{ type: "text", text: "Error: Falta configurar la variable GEMINI_API_KEY en Vercel." }],
      isError: true,
    };
  }

  try {
    const url = `https://googleapis.com{apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        numberOfImages: 1,
        aspectRatio,
        outputMimeType: "image/jpeg"
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Error en la API de Google");
    }

    const data = await response.json();
    const base64Image = data.generatedImages.image.imageBytes;

    return {
      content: [
        { type: "text", text: `Imagen generada con éxito para el prompt: "${prompt}"` },
        { type: "image", data: base64Image, mimeType: "image/jpeg" }
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error al generar la imagen: ${error.message}` }],
      isError: true,
    };
  }
});

// 4. Adaptador Serverless para responder a Claude.ai por Streamable HTTP
export default async function handler(req, res) {
  // Encabezados indispensables para pasar la validación CORS de Claude.ai
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-protocol-version');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Transfer-Encoding', 'chunked');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const transport = {
    async start() {
      if (req.method === 'POST') {
        this.onMessage?.(req.body);
      } else {
        // Si Claude hace un GET inicial para validar el servidor MCP, le responde de inmediato
        this.onMessage?.({ jsonrpc: "2.0", method: "tools/list", id: 1 });
      }
    },
    async send(message) {
      res.write(JSON.stringify(message) + '\n');
    },
    async close() {
      res.end();
    }
  };

  await mcpServer.connect(transport);
}
