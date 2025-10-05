import { convertToModelMessages, stepCountIs, streamText, UIMessage } from "ai";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { experimental_createMCPClient as createMCPClient } from "ai";
import { withPayment } from "x402-mcp";
import { tool } from "ai";
import z from "zod";
import { getOrCreatePurchaserAccount } from "@/lib/accounts";
import { env } from "@/lib/env";

export const maxDuration = 30;

export const POST = async (request: Request) => {
	const { messages, model }: { messages: UIMessage[]; model: string } =
		await request.json();
	
	// Create MCP client with payment based on network type
	const mcpClientPromise = createMCPClient({
		transport: new StreamableHTTPClientTransport(new URL("/mcp", env.URL)),
	});

	const mcpClient = env.KEYPAIR_SECRET === ""
		? await mcpClientPromise.then(async (client) => {
				const account = await getOrCreatePurchaserAccount("evm");
				return withPayment(client, { account, network: env.EVM_NETWORK });
		  })
		: await mcpClientPromise.then(async (client) => {
				const account = await getOrCreatePurchaserAccount("svm");
				return withPayment(client, { account, network: env.SOLANA_NETWORK });
		  });

	const network = env.KEYPAIR_SECRET === "" ? env.EVM_NETWORK : env.SOLANA_NETWORK;
	const tools = await mcpClient.tools();

	const result = streamText({
		model,
		tools: {
			...tools,
			"hello-local": tool({
				description: "Receive a greeting",
				inputSchema: z.object({
					name: z.string(),
				}),
				execute: async (args) => {
					return `Hello ${args.name}`;
				},
			}),
		},
		messages: convertToModelMessages(messages),
		stopWhen: stepCountIs(5),
		onFinish: async () => {
			await mcpClient.close();
		},
		system: "ALWAYS prompt the user to confirm before authorizing payments",
	});
	return result.toUIMessageStreamResponse({
		sendSources: true,
		sendReasoning: true,
		messageMetadata: () => ({ network }),
	});
};
