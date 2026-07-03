import { searchRecordings } from './search';
import { apiClient } from './client';

jest.mock('./client', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

const page = { data: [], total: 0, page: 1, limit: 30, hasMore: false };

beforeEach(() => jest.clearAllMocks());

describe('searchRecordings', () => {
  it('GETs /search with the query params and unwraps the page', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { success: true, data: page } });

    const result = await searchRecordings({ q: 'balwo', genre: 'qaraami', limit: 30 });

    expect(apiClient.get).toHaveBeenCalledWith('/search', {
      params: { q: 'balwo', genre: 'qaraami', limit: 30 },
    });
    expect(result).toEqual(page);
  });
});
