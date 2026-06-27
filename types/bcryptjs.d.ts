// types/bcryptjs.d.ts
declare module "bcryptjs" {
  export function hash(password: string | Buffer, saltOrRounds: string | number): Promise<string>;
  export function hashSync(password: string | Buffer, saltOrRounds: string | number): string;
  export function compare(data: string | Buffer, hash: string): Promise<boolean>;
  export function compareSync(data: string | Buffer, hash: string): boolean;
  export function genSalt(rounds?: number): Promise<string>;
  export function genSaltSync(rounds?: number): string;
  export function getRounds(hash: string): number;
}
