export default class User {
  public address: string;
  public balances: any = {};
  public allowances: any = {};

  constructor(address) {
    this.address = address;
  }

  // @ts-ignore
  async getBalances(tokens: string[]): Promise<number> {
    // return await multicall();
  }

  // @ts-ignore
  async getAllowances(tokens: string[]): Promise<number> {
    // return await multicall();
  }
}
