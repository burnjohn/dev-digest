export interface ReviewRepository {
  load(): Promise<string>;
}
