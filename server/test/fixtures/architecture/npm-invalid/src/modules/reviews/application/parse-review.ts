import { z } from 'zod';

export const reviewSchema = z.object({ id: z.string() });
