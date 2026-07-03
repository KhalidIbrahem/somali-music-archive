import { updateProfile, getSaved, saveRecording, unsaveRecording } from './users';
import { apiClient } from './client';

jest.mock('./client', () => ({
  apiClient: { patch: jest.fn(), get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

beforeEach(() => jest.clearAllMocks());

describe('users API', () => {
  it('PATCHes profile updates and unwraps the user', async () => {
    (apiClient.patch as jest.Mock).mockResolvedValue({
      data: { success: true, data: { id: 'u1', language: 'en' } },
    });
    const user = await updateProfile({ language: 'en' });
    expect(apiClient.patch).toHaveBeenCalledWith('/users/me', { language: 'en' });
    expect(user).toMatchObject({ language: 'en' });
  });

  it('GETs the saved list', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({ data: { success: true, data: [] } });
    await getSaved();
    expect(apiClient.get).toHaveBeenCalledWith('/users/me/saved');
  });

  it('POSTs and DELETEs a saved recording by id', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({
      data: { success: true, data: { saved: true } },
    });
    (apiClient.delete as jest.Mock).mockResolvedValue({
      data: { success: true, data: { saved: false } },
    });
    await saveRecording('rec-1');
    await unsaveRecording('rec-1');
    expect(apiClient.post).toHaveBeenCalledWith('/users/me/saved/rec-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/users/me/saved/rec-1');
  });
});
