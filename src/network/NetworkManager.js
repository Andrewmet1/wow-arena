/**
 * NetworkManager — WebSocket client for PvP multiplayer.
 * Connects to the game server, sends inputs, receives authoritative state.
 */
export class NetworkManager {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.wsAuthed = false; // True only when THIS WS connection has been authenticated
    this.roomCode = null;
    this.mySlot = null; // 0 or 1

    // Callbacks
    this.onRoomCreated = null;   // (roomCode, slot)
    this.onRoomJoined = null;    // (roomCode, slot)
    this.onMatchStart = null;    // (matchData)
    this.onTick = null;          // (tickData) — { t, u, e }
    this.onMatchEnd = null;      // (endData)
    this.onError = null;         // (message)
    this.onDisconnect = null;    // ()
    this.onOpponentDisconnected = null; // ()

    // Auth + matchmaking callbacks
    this.onAuthSuccess = null;   // (profile)
    this.onAuthError = null;     // (message)
    this.onUsernameSet = null;   // (profile)
    this.onQueueUpdate = null;   // ({ position, status })
    this.onQueueCancelled = null; // ()
    this.onMatchFound = null;    // ({ opponent, opponentElo })
    this.onProfile = null;       // (profile)
    this.onMatchHistory = null;  // (matches)
    this.onLeaderboard = null;   // (entries)

    // King of the Hill (legacy)
    this.onKing = null;          // (king)
    this.onKingUpdate = null;    // (king)

    // Per-class champions
    this.onClassChampions = null;   // (champions)
    this.onChampionUpdate = null;   // (updates)

    // Profile updates
    this.onUsernameChanged = null;  // (profile)
    this.onAvatarClassSet = null;   // (classId)

    // Social
    this.onFriendsList = null;        // (friends)
    this.onFriendRequests = null;     // (requests)
    this.onFriendRequestReceived = null; // ({ from, fromSub })
    this.onFriendRequestSent = null;  // ({ to })
    this.onFriendRequestAccepted = null; // ({ friendSub, friendUsername })
    this.onFriendAdded = null;        // ({ friendSub, friendUsername })
    this.onFriendRemoved = null;      // ({ friendSub })

    // Chat (legacy DM)
    this.onChatMessage = null;        // ({ fromSub, fromUsername, text, timestamp })
    this.onChatMessageSent = null;    // ({ toSub, text, timestamp })
    this.onChatHistory = null;        // ({ withSub, messages })

    // Channel Chat
    this.onChannelMessage = null;     // ({ channelId, fromSub, fromUsername, text, timestamp })
    this.onChannelMessageSent = null; // ({ channelId, text, timestamp })
    this.onChannelHistory = null;     // ({ channelId, messages })

    // Game invites
    this.onGameInvite = null;         // ({ fromSub, fromUsername, classId })
    this.onGameInviteSent = null;     // ({ toSub })
    this.onGameInviteDeclined = null; // ({ fromUsername })
    this.onGameInviteError = null;    // ({ message })

    // 2v2 Party
    this.onPartyInvite = null;       // ({ fromSub, fromUsername })
    this.onPartyAccepted = null;     // ({ fromSub, fromUsername, classId })
    this.onPartyDeclined = null;     // ({ fromSub, fromUsername })
    this.onPartyLeft = null;         // ({ fromSub })
    this.onPartyClassUpdate = null;  // ({ fromSub, classId })
    this.onPartyReady = null;        // ({ fromSub, ready })

    // Betting
    this.onMyBets = null;            // (bets[])
    this.onBetPlaced = null;         // ({ betId, odds, newCoins })
    this.onJackpot = null;           // ({ total })

    // Shop purchases
    this.onPurchaseSuccess = null;   // ({ itemId, newCoins, inventory })
    this.onPurchaseError = null;     // ({ message })
    this.onCoinsPurchased = null;    // ({ coins, packageId, newCoins })
    this.onCoinsRefunded = null;     // ({ coins, newCoins })

    // Practice rewards
    this.onPracticeReward = null;    // ({ coins, newCoins })

    // Spectator
    this.onChampionMatchStarting = null; // ({ roomCode, championClass, championUsername, opponentClass, opponentUsername })
    this.onSpectatorInit = null;         // (initData) — full state snapshot
    this.onSpectatorTick = null;         // (tickData) — same format as onTick
    this.onSpectatorMatchEnd = null;     // (resultData)
    this.onSpectatorCount = null;        // ({ count, roomCode })
    this.onLiveChampionMatches = null;   // ({ matches: [{ roomCode, championClass, ... }] })

    // Async Wager Duels
    this.onDuelSent = null;          // ({ duelId, targetUsername, wager, amplifier, newCoins })
    this.onDuelReceived = null;      // ({ duelId, wager, amplifier, challengerUsername, challengerElo, challengerClassId })
    this.onDuelAccepted = null;      // ({ duelId, ... })
    this.onDuelDeclined = null;      // ({ duelId, refundedCoins?, newCoins? })
    this.onDuelCancelled = null;     // ({ duelId, newCoins? })
    this.onDuelExpired = null;       // ({ duelId })
    this.onDuelError = null;         // ({ message })
    this.onDuelInbox = null;         // ({ incoming, outgoing, activeDuel })
    this.onDuelReadyUpdate = null;   // ({ duelId, challengerReadyAt?, defenderReadyAt? })
    this.onDuelMatchStart = null;    // ({ roomCode, duelId, slot, playerClass, enemyClass, wager, amplifier })
    this.onDuelForfeit = null;       // ({ duelId, winnerSub, forfeitSub, wager })
  }

  /**
   * Connect to the PvP server
   * @param {string} serverUrl — e.g. 'wss://pvp.example.com' or 'ws://localhost:3001'
   */
  connect(serverUrl) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = () => {
        this.connected = true;
        this.wsAuthed = false; // New connection — not yet authenticated
        resolve();
      };

      this.ws.onerror = (err) => {
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.wsAuthed = false;
        if (this.onDisconnect) this.onDisconnect();
      };

      this.ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        this._handleMessage(msg);
      };
    });
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'room_created':
        this.roomCode = msg.roomCode;
        this.mySlot = msg.slot;
        if (this.onRoomCreated) this.onRoomCreated(msg.roomCode, msg.slot);
        break;

      case 'room_joined':
        this.roomCode = msg.roomCode;
        this.mySlot = msg.slot;
        if (this.onRoomJoined) this.onRoomJoined(msg.roomCode, msg.slot);
        break;

      case 'match_start':
        this.mySlot = msg.yourSlot;
        if (this.onMatchStart) this.onMatchStart(msg);
        break;

      case 'match_begin':
        this._fireOnce('match_begin', msg);
        break;

      case 'loading_progress':
        this._fireOnce('loading_progress', msg);
        if (this.onLoadingProgress) this.onLoadingProgress(msg);
        break;

      case 'tick':
        if (this.onTick) this.onTick(msg);
        break;

      case 'match_end':
        if (this.onMatchEnd) this.onMatchEnd(msg);
        break;

      case 'opponent_disconnected':
        if (this.onOpponentDisconnected) this.onOpponentDisconnected();
        break;

      case 'error':
        if (this.onError) this.onError(msg.message);
        break;

      // Auth + matchmaking
      case 'auth_success':
        this.wsAuthed = true;
        if (this.onAuthSuccess) this.onAuthSuccess(msg.profile);
        break;

      case 'auth_error':
        if (this.onAuthError) this.onAuthError(msg.message);
        break;

      case 'auth_banned':
        if (this.onAuthBanned) this.onAuthBanned(msg);
        break;

      case 'appeal_accepted':
        if (this.onAppealAccepted) this.onAppealAccepted(msg);
        break;

      case 'username_set':
        if (this.onUsernameSet) this.onUsernameSet(msg.profile);
        break;

      case 'queue_update':
        if (this.onQueueUpdate) this.onQueueUpdate(msg);
        break;

      case 'queue_cancelled':
        if (this.onQueueCancelled) this.onQueueCancelled();
        break;

      case 'match_found':
        if (this.onMatchFound) this.onMatchFound(msg);
        break;

      case 'profile':
        if (this.onProfile) this.onProfile(msg.profile);
        break;

      case 'match_history':
        if (this.onMatchHistory) this.onMatchHistory(msg.matches);
        break;

      case 'leaderboard':
        if (this.onLeaderboard) this.onLeaderboard(msg.entries);
        break;

      // King of the Hill
      case 'king':
        if (this.onKing) this.onKing(msg.king);
        break;
      case 'king_update':
        if (this.onKingUpdate) this.onKingUpdate(msg.king);
        break;

      // Per-class champions
      case 'class_champions':
        if (this.onClassChampions) this.onClassChampions(msg.champions);
        break;
      case 'champion_update':
        if (this.onChampionUpdate) this.onChampionUpdate(msg.updates);
        break;

      // Profile updates
      case 'username_changed':
        if (this.onUsernameChanged) this.onUsernameChanged(msg.profile);
        break;
      case 'avatar_class_set':
        if (this.onAvatarClassSet) this.onAvatarClassSet(msg.classId);
        break;

      // Friends
      case 'friends_list':
        if (this.onFriendsList) this.onFriendsList(msg.friends);
        break;
      case 'friend_requests':
        if (this.onFriendRequests) this.onFriendRequests(msg.requests);
        break;
      case 'friend_request_received':
        if (this.onFriendRequestReceived) this.onFriendRequestReceived(msg);
        break;
      case 'friend_request_sent':
        if (this.onFriendRequestSent) this.onFriendRequestSent(msg);
        break;
      case 'friend_request_accepted':
        if (this.onFriendRequestAccepted) this.onFriendRequestAccepted(msg);
        break;
      case 'friend_added':
        if (this.onFriendAdded) this.onFriendAdded(msg);
        break;
      case 'friend_removed':
        if (this.onFriendRemoved) this.onFriendRemoved(msg);
        break;
      case 'friend_request_declined':
        break; // silent ack

      // Chat (legacy DM)
      case 'chat_message':
        if (this.onChatMessage) this.onChatMessage(msg);
        break;
      case 'chat_message_sent':
        if (this.onChatMessageSent) this.onChatMessageSent(msg);
        break;
      case 'chat_history':
        if (this.onChatHistory) this.onChatHistory(msg);
        break;

      // Channel Chat
      case 'channel_message':
        if (this.onChannelMessage) this.onChannelMessage(msg);
        break;
      case 'channel_message_sent':
        if (this.onChannelMessageSent) this.onChannelMessageSent(msg);
        break;
      case 'channel_history':
        if (this.onChannelHistory) this.onChannelHistory(msg);
        break;

      // Game invites
      case 'game_invite':
        if (this.onGameInvite) this.onGameInvite(msg);
        break;
      case 'game_invite_sent':
        if (this.onGameInviteSent) this.onGameInviteSent(msg);
        break;
      case 'game_invite_declined':
        if (this.onGameInviteDeclined) this.onGameInviteDeclined(msg);
        break;
      case 'game_invite_error':
        if (this.onGameInviteError) this.onGameInviteError(msg);
        break;

      // 2v2 Party
      case 'party_invite_2v2':
        if (this.onPartyInvite) this.onPartyInvite(msg);
        break;
      case 'party_accepted_2v2':
        if (this.onPartyAccepted) this.onPartyAccepted(msg);
        break;
      case 'party_declined_2v2':
        if (this.onPartyDeclined) this.onPartyDeclined(msg);
        break;
      case 'party_left_2v2':
        if (this.onPartyLeft) this.onPartyLeft(msg);
        break;
      case 'party_class_update':
        if (this.onPartyClassUpdate) this.onPartyClassUpdate(msg);
        break;
      case 'party_ready':
        if (this.onPartyReady) this.onPartyReady(msg);
        break;

      // Betting
      case 'my_bets':
        if (this.onMyBets) this.onMyBets(msg.bets);
        break;
      case 'bet_placed':
        if (this.onBetPlaced) this.onBetPlaced(msg);
        break;
      case 'jackpot':
        if (this.onJackpot) this.onJackpot(msg);
        break;

      // Practice rewards
      case 'practice_reward':
        if (this.onPracticeReward) this.onPracticeReward(msg);
        break;

      // Async Wager Duels
      case 'duel_sent':
        if (this.onDuelSent) this.onDuelSent(msg);
        break;
      case 'duel_received':
        if (this.onDuelReceived) this.onDuelReceived(msg);
        break;
      case 'duel_accepted':
        if (this.onDuelAccepted) this.onDuelAccepted(msg);
        break;
      case 'duel_declined':
        if (this.onDuelDeclined) this.onDuelDeclined(msg);
        break;
      case 'duel_cancelled':
        if (this.onDuelCancelled) this.onDuelCancelled(msg);
        break;
      case 'duel_expired':
        if (this.onDuelExpired) this.onDuelExpired(msg);
        break;
      case 'duel_error':
        if (this.onDuelError) this.onDuelError(msg);
        break;
      case 'duel_inbox':
        if (this.onDuelInbox) this.onDuelInbox(msg);
        break;
      case 'duel_ready_update':
        if (this.onDuelReadyUpdate) this.onDuelReadyUpdate(msg);
        break;
      case 'duel_match_start':
        if (this.onDuelMatchStart) this.onDuelMatchStart(msg);
        break;
      case 'duel_forfeit':
        if (this.onDuelForfeit) this.onDuelForfeit(msg);
        break;

      // Spectator
      case 'champion_match_starting':
        if (this.onChampionMatchStarting) this.onChampionMatchStarting(msg);
        break;
      case 'spectator_init':
        if (this.onSpectatorInit) this.onSpectatorInit(msg);
        break;
      case 'spectator_tick':
        if (this.onSpectatorTick) this.onSpectatorTick(msg);
        break;
      case 'spectator_match_end':
        if (this.onSpectatorMatchEnd) this.onSpectatorMatchEnd(msg);
        break;
      case 'spectator_count':
        if (this.onSpectatorCount) this.onSpectatorCount(msg);
        break;
      case 'live_champion_matches':
        if (this.onLiveChampionMatches) this.onLiveChampionMatches(msg);
        break;

      // Shop purchases
      case 'purchase_success':
        if (this.onPurchaseSuccess) this.onPurchaseSuccess(msg);
        this._fireOnce('purchase_success', msg);
        break;
      case 'purchase_error':
        if (this.onPurchaseError) this.onPurchaseError(msg);
        this._fireOnce('purchase_error', msg);
        break;
      case 'coins_purchased':
        if (this.onCoinsPurchased) this.onCoinsPurchased(msg);
        this._fireOnce('coins_purchased', msg);
        break;
      case 'coins_refunded':
        if (this.onCoinsRefunded) this.onCoinsRefunded(msg);
        this._fireOnce('coins_refunded', msg);
        break;

      // Cosmetic equip confirmation
      case 'cosmetic_equipped':
        if (this.onCosmeticEquipped) this.onCosmeticEquipped(msg);
        this._fireOnce('cosmetic_equipped', msg);
        break;

      // Battle Pass
      case 'battle_pass':
        if (this.onBattlePass) this.onBattlePass(msg);
        this._fireOnce('battle_pass', msg);
        break;

      // Challenges
      case 'challenges':
        if (this.onChallenges) this.onChallenges(msg);
        this._fireOnce('challenges', msg);
        break;

      // Dungeon (PvE roguelike) — solo descent
      case 'dungeon_start':
        // Set mySlot here too — _startPvPMatch reads net.mySlot to determine
        // the local player's unit. Without this, units[mySlot] is undefined.
        this.mySlot = msg.yourSlot ?? 0;
        if (this.onDungeonStart) this.onDungeonStart(msg);
        this._fireOnce('dungeon_start', msg);
        break;
      case 'dungeon_room_clear':
        if (this.onDungeonRoomClear) this.onDungeonRoomClear(msg);
        break;
      case 'dungeon_next_room':
        if (this.onDungeonNextRoom) this.onDungeonNextRoom(msg);
        break;
      case 'dungeon_complete':
        if (this.onDungeonComplete) this.onDungeonComplete(msg);
        break;
      case 'dungeon_chest_opened':
        if (this.onDungeonChestOpened) this.onDungeonChestOpened(msg);
        break;
      case 'dungeon_lever_pulled':
        if (this.onDungeonLeverPulled) this.onDungeonLeverPulled(msg);
        break;
      case 'dungeon_room_cleared':
        if (this.onDungeonRoomCleared) this.onDungeonRoomCleared(msg);
        break;
      case 'dungeon_inventory':
        if (this.onDungeonInventory) this.onDungeonInventory(msg);
        break;
      case 'dungeon_equip_ok':
        if (this.onDungeonEquipOk) this.onDungeonEquipOk(msg);
        break;
      case 'dungeon_socket_ok':
        if (this.onDungeonSocketOk) this.onDungeonSocketOk(msg);
        break;
      case 'dungeon_ladder':
        if (this.onDungeonLadder) this.onDungeonLadder(msg);
        break;
      case 'dungeon_progression':
        if (this.onDungeonProgression) this.onDungeonProgression(msg);
        break;
      case 'dungeon_feature_update':
        if (this.onDungeonFeatureUpdate) this.onDungeonFeatureUpdate(msg);
        break;
      case 'dungeon_loot_drop':
        if (this.onDungeonLootDrop) this.onDungeonLootDrop(msg);
        break;
      case 'dungeon_mob_loot':
        if (this.onDungeonMobLoot) this.onDungeonMobLoot(msg);
        break;
      case 'dungeon_shrine_resolved':
        if (this.onDungeonShrineResolved) this.onDungeonShrineResolved(msg);
        break;
      case 'dungeon_puzzle_open':
        if (this.onDungeonPuzzleOpen) this.onDungeonPuzzleOpen(msg);
        break;
      case 'dungeon_puzzle_resolved':
        if (this.onDungeonPuzzleResolved) this.onDungeonPuzzleResolved(msg);
        break;
      case 'dungeon_mob_coin':
        if (this.onDungeonMobCoin) this.onDungeonMobCoin(msg);
        break;
      case 'dungeon_wallet_update':
        if (this.onDungeonWalletUpdate) this.onDungeonWalletUpdate(msg);
        break;
      case 'dungeon_sell_result':
        if (this.onDungeonSellResult) this.onDungeonSellResult(msg);
        break;
      case 'dungeon_vendor_open':
        if (this.onDungeonVendorOpen) this.onDungeonVendorOpen(msg);
        break;
      case 'dungeon_vendor_result':
        if (this.onDungeonVendorResult) this.onDungeonVendorResult(msg);
        break;
      case 'dungeon_well_consumed':
        if (this.onDungeonWellConsumed) this.onDungeonWellConsumed(msg);
        break;
      case 'dungeon_brazier_lit':
        if (this.onDungeonBrazierLit) this.onDungeonBrazierLit(msg);
        break;
      case 'dungeon_idol_channeled':
        if (this.onDungeonIdolChanneled) this.onDungeonIdolChanneled(msg);
        break;
      case 'dungeon_bell_rung':
        if (this.onDungeonBellRung) this.onDungeonBellRung(msg);
        break;
    }
  }

  sendDungeonInteract(featureId) {
    this._send({ type: 'dungeon_interact', featureId });
  }

  // ── Dungeon competition (tier / gear / gems / ladder) ──────────────
  startDungeon(classId, tier = 1) {
    this._send({ type: 'start_dungeon', classId, tier });
  }
  getDungeonInventory(classId) {
    this._send({ type: 'dungeon_inventory_get', classId });
  }
  equipDungeonGear(classId, slot, itemId) {
    this._send({ type: 'dungeon_equip', classId, slot, itemId });
  }
  socketDungeonGem(classId, slotIndex, gemId) {
    this._send({ type: 'dungeon_socket_gem', classId, slotIndex, gemId });
  }
  getDungeonLadder({ classId, tier, partySize = 1, limit = 20 }) {
    this._send({ type: 'dungeon_ladder_get', classId, tier, partySize, limit });
  }
  getDungeonProgression() {
    this._send({ type: 'dungeon_progression_get' });
  }

  /** Register a one-time callback for a message type */
  once(type, cb) {
    if (!this._onceListeners) this._onceListeners = {};
    if (!this._onceListeners[type]) this._onceListeners[type] = [];
    this._onceListeners[type].push(cb);
  }

  _fireOnce(type, data) {
    if (!this._onceListeners?.[type]) return;
    const cbs = this._onceListeners[type];
    this._onceListeners[type] = [];
    for (const cb of cbs) cb(data);
  }

  // ── Auth + Matchmaking ──────────────────────────────────────────

  authenticate(idToken) {
    this._send({ type: 'authenticate', token: idToken });
  }

  setUsername(username) {
    this._send({ type: 'set_username', username });
  }

  joinQueue(classId, skinId) {
    this._send({ type: 'queue_join', classId, skinId: skinId || undefined });
  }

  cancelQueue() {
    this._send({ type: 'queue_cancel' });
  }

  getProfile() {
    this._send({ type: 'get_profile' });
  }

  getMatchHistory() {
    this._send({ type: 'get_match_history' });
  }

  getLeaderboard() {
    this._send({ type: 'get_leaderboard' });
  }

  // ── King of the Hill ──────────────────────────────────────────

  getKing() {
    this._send({ type: 'get_king' });
  }

  // ── Per-Class Champions ────────────────────────────────────────

  getClassChampions() {
    this._send({ type: 'get_class_champions' });
  }

  // ── Profile Updates ────────────────────────────────────────────

  changeUsername(username) {
    this._send({ type: 'change_username', username });
  }

  setAvatarClass(classId) {
    this._send({ type: 'set_avatar_class', classId });
  }

  // ── Friends ───────────────────────────────────────────────────

  sendFriendRequest(username) {
    this._send({ type: 'send_friend_request', username });
  }

  acceptFriendRequest(fromSub) {
    this._send({ type: 'accept_friend_request', fromSub });
  }

  declineFriendRequest(fromSub) {
    this._send({ type: 'decline_friend_request', fromSub });
  }

  removeFriend(friendSub) {
    this._send({ type: 'remove_friend', friendSub });
  }

  getFriends() {
    this._sendReliable({ type: 'get_friends' });
  }

  getFriendRequests() {
    this._sendReliable({ type: 'get_friend_requests' });
  }

  // ── Chat (legacy DM) ─────────────────────────────────────────

  sendChatMessage(toSub, text) {
    this._send({ type: 'send_chat_message', toSub, text });
  }

  getChatHistory(withSub) {
    this._send({ type: 'get_chat_history', withSub });
  }

  // ── Channel Chat ────────────────────────────────────────────

  sendChannelMessage(channelId, text) {
    this._send({ type: 'send_channel_message', channelId, text });
  }

  getChannelHistory(channelId) {
    this._send({ type: 'get_channel_history', channelId });
  }

  joinGlobalChat() {
    this._send({ type: 'join_global_chat' });
  }

  leaveGlobalChat() {
    this._send({ type: 'leave_global_chat' });
  }

  // ── Game Invites ──────────────────────────────────────────────

  sendGameInvite(toSub, classId) {
    this._send({ type: 'send_game_invite', toSub, classId });
  }

  acceptGameInvite(inviterSub, classId) {
    this._send({ type: 'accept_game_invite', inviterSub, classId });
  }

  declineGameInvite(inviterSub) {
    this._send({ type: 'decline_game_invite', inviterSub });
  }

  // ── 2v2 Party ───────────────────────────────────────────────

  sendPartyInvite(toSub, mode = 'ranked') {
    this._send({ type: 'send_party_invite_2v2', toSub, mode });
  }

  acceptPartyInvite(fromSub, classId) {
    this._send({ type: 'accept_party_invite_2v2', fromSub, classId });
  }

  declinePartyInvite(fromSub) {
    this._send({ type: 'decline_party_invite_2v2', fromSub });
  }

  sendPartyReady(partnerSub, ready) {
    this._send({ type: 'party_ready', partnerSub, ready });
  }

  updatePartyClass(partnerSub, classId) {
    this._send({ type: 'update_party_class', partnerSub, classId });
  }

  leaveParty(partnerSub) {
    this._send({ type: 'leave_party_2v2', partnerSub });
  }

  startCoopPractice(classId, partnerSub, partnerClassId, enemy1ClassId, enemy2ClassId) {
    this._send({ type: 'start_coop_practice', classId, partnerSub, partnerClassId, enemy1ClassId, enemy2ClassId });
  }

  // ── Custom Rooms ──────────────────────────────────────────────

  /**
   * Create a new room (you become player 0)
   */
  createRoom(classId) {
    this._send({ type: 'create_room', classId });
  }

  /**
   * Join an existing room (you become player 1)
   */
  joinRoom(roomCode, classId) {
    this._send({ type: 'join_room', roomCode: roomCode.toUpperCase(), classId });
  }

  /**
   * Send player input to the server
   * @param {Object} input — { abilities?: string[], moveDir?: {x,z}, stopMove?: bool, facing?: number }
   */
  sendInput(input) {
    this._send({ type: 'input', ...input });
  }

  // ── Spectator ────────────────────────────────────────────────

  spectateMatch(roomCode) {
    this._send({ type: 'spectate_match', roomCode });
  }

  leaveSpectate() {
    this._send({ type: 'leave_spectate' });
  }

  getLiveChampionMatches() {
    this._send({ type: 'get_live_champion_matches' });
  }

  // ── Async Wager Duels ────────────────────────────────────────
  sendDuel(targetUsername, wager, classId) {
    this._send({ type: 'send_duel', targetUsername, wager, classId });
  }

  cancelDuel(duelId) {
    this._send({ type: 'cancel_duel', duelId });
  }

  acceptDuel(duelId, classId) {
    this._send({ type: 'accept_duel', duelId, classId });
  }

  declineDuel(duelId) {
    this._send({ type: 'decline_duel', duelId });
  }

  getDuelInbox() {
    this._send({ type: 'get_duel_inbox' });
  }

  readyDuel(duelId) {
    this._send({ type: 'ready_duel', duelId });
  }

  unreadyDuel(duelId) {
    this._send({ type: 'unready_duel', duelId });
  }

  // ── 2v2 Queue ──────────────────────────────────────────────────

  joinQueue2v2(classId) {
    this._send({ type: 'queue_join_2v2', classId });
  }

  joinQueue2v2Duo(classId, partnerSub, partnerClassId) {
    this._send({ type: 'queue_join_2v2_duo', classId, partnerSub, partnerClassId });
  }

  leaveQueue2v2() {
    this._send({ type: 'queue_leave_2v2' });
  }

  /** Public send — for ad-hoc messages from UI code */
  send(msg) { this._send(msg); }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[NetworkManager] Dropped message (WS not OPEN):', msg.type, 'readyState:', this.ws?.readyState);
    }
  }

  /** Send with retry — waits for WS OPEN up to 2s, then sends */
  async _sendReliable(msg, maxWait = 2000) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 50));
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
        return true;
      }
    }
    console.warn('[NetworkManager] _sendReliable timed out for:', msg.type);
    return false;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.wsAuthed = false;
    this.roomCode = null;
    this.mySlot = null;
  }
}
