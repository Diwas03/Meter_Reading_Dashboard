// Narrow adapter shared by production clients and local HTTP contract tests.
export interface Admin {
  auth: {
    getUser(
      token: string,
    ): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  rpc(
    name: string,
    params: Record<string, unknown>,
  ): PromiseLike<{
    data: Record<string, unknown> | string | null;
    error: { message: string } | null;
  }>;
}
