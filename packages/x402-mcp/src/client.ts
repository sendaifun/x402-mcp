import { z, ZodType } from "zod";
import {
	Address,
	createPublicClient,
	createWalletClient,
	http,
	parseAbi,
	type Account,
} from "viem";
import {
	avalanche,
	avalancheFuji,
	sei,
	seiTestnet,
	iotex,
	base,
	baseSepolia,
} from "viem/chains";
import { createPaymentHeader } from "x402/client";
import { Wallet } from "x402/types";
import { x402Version } from "./shared.js";
import {
	Tool,
	ToolCallOptions,
	experimental_MCPClient as MCPClient,
	tool,
} from "ai";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { EvmNetwork, SvmNetwork } from "./types.js";
import { KeyPairSigner, createSolanaRpc, address as svmAddress } from "@solana/kit";

interface MCPClientInternal extends MCPClient {
	// Private methods
	request: <T extends ZodType<object>>(params: {
		request: any;
		resultSchema: T;
		options?: any;
	}) => Promise<z.infer<T>>;
	assertCapability: (method: string) => void;
	isClosed: boolean;
}

async function callToolWithPayment(
	client: MCPClientInternal,
	name: string,
	args: Record<string, unknown>,
	paymentAuthorization: string,
	options?: ToolCallOptions,
) {
	// Access private methods
	const request = client.request.bind(client);
	const assertCapability = client.assertCapability.bind(client);

	if (client.isClosed) {
		throw new Error("Attempted to send a request from a closed client");
	}

	assertCapability("tools/call");

	return request({
		request: {
			method: "tools/call",
			params: {
				name,
				arguments: args,
				_meta: {
					"x402/payment": paymentAuthorization,
				},
			},
		},
		resultSchema: CallToolResultSchema,
		options: {
			signal: options?.abortSignal,
		},
	});
}

export interface EvmClientPaymentOptions {
	account: Account | Address;
	maxPaymentValue?: number;
	network: EvmNetwork;
}

export interface SvmClientPaymentOptions {
	account: KeyPairSigner;
	maxPaymentValue?: number;
	network: SvmNetwork;
}

export type ClientPaymentOptions =
	| EvmClientPaymentOptions
	| SvmClientPaymentOptions;

const EvmAddressRegex = /^0x[0-9a-fA-F]{40}$/;
const SvmAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const networkToChain = {
	"base-sepolia": baseSepolia,
	base: base,
	"avalanche-fuji": avalancheFuji,
	avalanche: avalanche,
	iotex: iotex,
	sei: sei,
	"sei-testnet": seiTestnet,
} as const;

const isSvmOptions = (o: ClientPaymentOptions): o is SvmClientPaymentOptions =>
	o.network === "solana" || o.network === "solana-devnet";

const getAccountAddress = (options: ClientPaymentOptions, account: Account | Address | KeyPairSigner): string => {
	return isSvmOptions(options) ? account.toString(): (account as Address);
}

const getEvmPublicClient = (options: EvmClientPaymentOptions) => {
	return createPublicClient({
		chain: networkToChain[options.network],
		transport: http(),
	});
}

const getSvmPublicClient = (options: SvmClientPaymentOptions) => {
	return createSolanaRpc(options.network === "solana-devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
}

const networkToUsdcAddress = {
	"base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
	base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
	"solana-devnet": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
	"avalanche-fuji": "0x9664f526ec410929ed7472f9097fa9a4b7e57093",
	avalanche: "0x9664f526ec410929ed7472f9097fa9a4b7e57093",
	iotex: "0x9664f526ec410929ed7472f9097fa9a4b7e57093",
	sei: "0x9664f526ec410929ed7472f9097fa9a4b7e57093",
	"sei-testnet": "0x9664f526ec410929ed7472f9097fa9a4b7e57093",
} as const;

export async function withPayment(
	mcpClient: MCPClient,
	options: ClientPaymentOptions,
): Promise<MCPClient> {
	const client = mcpClient as MCPClientInternal;
	const maxPaymentValue = options.maxPaymentValue ?? BigInt(0.1 * 10 ** 6); // 0.10 USDC

	const viewAccountBalanceTool = tool({
		description:
			"View the balance of the account in USDC. (USDC has 6 decimals, always divide by 10**6 to get the amount in USDC)",
		inputSchema: z.object({}),
		outputSchema: z.object({
			amount: z
				.string()
				.describe(
					"uint256 as string -  balance of the account in USDC. (USDC has 6 decimals, always divide by 10**6 to get the amount in USDC)",
				),
		}),
		execute: async () => {
			const address = getAccountAddress(options, options.account);
		    if (isSvmOptions(options)) { 
				const {value} = await getSvmPublicClient(options).getBalance(svmAddress(address)).send()
				return {
					amount: value.toString(),
				};
			} else {
				const result = await getEvmPublicClient(options).getBalance({ 
					address: address as Address 
				});
				return {
					amount: result.toString(),
				};
			}
		},
	});

	const generatePaymentAuthorizationTool = tool({
		description:
			"Generate a x402 payment authorization for another tool call which requires payment. Never guess the payment requirements, if you even need to call this its because you already know the payment requirements from another tool call.",
		inputSchema: z.object({
			paymentRequirements: z.object({
				scheme: z.literal("exact"),
				network: z.enum(["base-sepolia", "base", "solana", "solana-devnet", "avalanche-fuji", "avalanche", "iotex", "sei", "sei-testnet"]),
				maxAmountRequired: z
					.string()
					.describe(
						"uint256 as string. if you need to display this to the user, divide by 10**6 to get the amount in USDC",
					),
				resource: z.string().url(),
				description: z.string(),
				mimeType: z.string(),
				outputSchema: z.record(z.any()).optional(),
				payTo: z.string().regex(isSvmOptions(options) ? SvmAddressRegex : EvmAddressRegex),
				maxTimeoutSeconds: z.number().int(),
				asset: z.string().regex(isSvmOptions(options) ? SvmAddressRegex : EvmAddressRegex),
				extra: z
					.any()
					.describe(
						"This field is an optional schema-specific object. If the payment requirements specifies it, you *must* include it.",
					),
			}),
		}),
		outputSchema: z.object({
			paymentAuthorization: z.string(),
		}),
		execute: async (input) => {
			const maxAmountRequired = BigInt(
				input.paymentRequirements.maxAmountRequired,
			);
			if (maxAmountRequired > maxPaymentValue) {
				throw new Error(
					"Payment requirements exceed user configured max payment value",
				);
			}

			if (input.paymentRequirements.scheme !== "exact") {
				throw new Error("Only exact scheme is supported");
			}

			if (input.paymentRequirements.network !== options.network) {
				throw new Error("Unsupported payment network");
			}

			const paymentHeader = await createPaymentHeader(
				options.account as unknown as Wallet | KeyPairSigner, // dont know why this is needed
				x402Version,
				input.paymentRequirements,
			);
			return {
				paymentAuthorization: paymentHeader,
			};
		},
	});

	// Store reference to original tools method before overriding it
	const originalToolsMethod = client.tools.bind(client);

	const wrappedTools: MCPClient["tools"] = async (options) => {
		// Get the original tools from the wrapped client using the stored reference
		const originalTools = await originalToolsMethod(options);
		const wrappedToolsMap: Record<string, Tool> = {};

		// Wrap each tool to add payment support
		for (const [name, tool] of Object.entries(originalTools)) {
			wrappedToolsMap[name] = {
				...tool,
				// @ts-expect-error
				inputSchema: {
					...tool.inputSchema,
					jsonSchema: {
						// @ts-expect-error
						...tool.inputSchema.jsonSchema,
						properties: {
							// @ts-expect-error
							...tool.inputSchema.jsonSchema.properties,
							paymentAuthorization: {
								type: "string",
								description:
									"X402Payment authorization, this is optional and should *not* be provided by default. It is only required if the tool requires payment, which can be determined by calling it without this parameter.",
							},
						},
					},
				},
				execute: async (
					args: Record<string, unknown> & { paymentAuthorization?: string },
					toolOptions: ToolCallOptions,
				) => {
					// Extract paymentAuthorization from args
					const { paymentAuthorization, ...toolArgs } = args;

					if (paymentAuthorization) {
						// Create a custom callTool request that includes _meta
						return callToolWithPayment(
							client,
							name,
							toolArgs,
							paymentAuthorization,
							toolOptions,
						);
					} else {
						// Call the original execute function without payment
						if (!tool.execute) {
							throw new Error(`Tool ${name} does not have an execute function`);
						}
						return tool.execute(toolArgs, toolOptions);
					}
				},
			};
		}

		return {
			...wrappedToolsMap,
			generatePaymentAuthorization: generatePaymentAuthorizationTool,
			viewAccountBalance: viewAccountBalanceTool,
		} as any;
	};

	client.tools = wrappedTools;
	return client;
}
