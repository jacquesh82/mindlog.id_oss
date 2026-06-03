package today.mindlog.id.core.network.dto

// Ce fichier a été éclaté en fichiers thématiques lors du refactoring (2026-06-01).
// Les data classes se trouvent désormais dans :
//   - CommonDtos.kt    → OkDto, FieldUpsertResponse
//   - AuthDtos.kt      → SessionDto, RedeemPinBody/Response, ActiveSession(s)Dto, PinDto,
//                        RotateKeyDto, PasskeyAuth*
//   - ProfileDtos.kt   → FieldDto, MeDto, SettingsDto, SettingsPatchBody, UpsertFieldBody,
//                        AddTagBody, TagsResponseDto, RecoveryEmailBody,
//                        SearchResponseDto/ResultDto, PublicCardDto, OptionsDto, ViewerDto
//   - AgendaDtos.kt    → EventDto, AddEventBody, AvailabilityBody, SlotsDto, SlotDto
//   - RelationDtos.kt  → RelationDto, AddRelationBody, NotificationDto,
//                        ConversationDto, ConvMessageMetaDto
//   - BookingDtos.kt   → RequestDto, CreateRequestBody, RequestStatusBody
//   - MessageDtos.kt   → ReactionDto, MessageDto, MessagesResponseDto, SendMessageBody,
//                        EnvelopeBody, AckBody, ReactBody, AttachmentDto, SignalBody
//   - GroupDtos.kt     → GroupMemberDto, GroupDto, GroupsResponseDto, GroupMessageDto,
//                        GroupMessagesResponseDto, CreateGroupBody, GroupMessageBody, AddMemberBody
//   - E2eDtos.kt       → PubkeyBody, VaultDto/Body, RatchetCacheDto/Body, OpkBody,
//                        PrekeyBundleBody/Dto, PrekeyCountDto, RegisterDeviceBody/Dto,
//                        DeviceDto, DevicesDto, DeviceBundleDto/sDto, VerifyBody/Dto
//   - SocialDtos.kt    → InviteDto, InvitePreviewDto, InviteAcceptDto
//
// Tous les fichiers conservent le même package → aucun import à modifier chez les callers.
