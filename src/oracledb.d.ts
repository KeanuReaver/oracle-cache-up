declare module 'oracledb' {
    export type Connection = any;

    export const STRING: any;

    export function getConnection(config: any): Promise<Connection>;
}