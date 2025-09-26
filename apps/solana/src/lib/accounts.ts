import {generateKeyPairSigner, type KeyPairSigner} from "@solana/kit"
import {createSolanaRpc , createKeyPairSignerFromBytes, createSignerFromKeyPair, getBase58Encoder} from "@solana/kit"
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { env } from "./env";


export async function getOrCreatePurchaserAccount(): Promise<KeyPairSigner> {
	const account =  env.KEYPAIR_SECRET ? await createKeyPairSignerFromBytes(getBase58Encoder().encode(env.KEYPAIR_SECRET)) : await generateKeyPairSigner();


	console.log(account.address.toString());


	return account;
}

export async function getOrCreateSellerAccount(): Promise<KeyPairSigner> {
	const account = await generateKeyPairSigner();

	return account;
}
