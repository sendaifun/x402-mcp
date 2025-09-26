import {generateKeyPairSigner, type KeyPairSigner} from "@solana/kit"
import {createSolanaRpc , createKeyPairFromPrivateKeyBytes, createSignerFromKeyPair} from "@solana/kit"
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { env } from "./env";


export async function getOrCreatePurchaserAccount(): Promise<KeyPairSigner> {
	const account =  env.KEYPAIR_SECRET ? await createSignerFromKeyPair(await createKeyPairFromPrivateKeyBytes(env.KEYPAIR_SECRET)) : await generateKeyPairSigner();

	const solanaRpc = createSolanaRpc(env.NETWORK === "solana-devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");

	const tokenAccount = await findAssociatedTokenPda({
		owner: account.address,
		mint: TOKEN_PROGRAM_ADDRESS,
		tokenProgram: TOKEN_PROGRAM_ADDRESS,
	});

	const {value} = await solanaRpc.getTokenAccountBalance(tokenAccount[0]).send();

	const usdcBalance = value.amount;

	// usdc faucet logic is not implemented yet

	return account;
}

export async function getOrCreateSellerAccount(): Promise<KeyPairSigner> {
	const account = await generateKeyPairSigner();

	return account;
}
