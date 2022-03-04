// @TODO implementar 'clicar na notificacao' abre a janela do chat
import { Meteor } from 'meteor/meteor';
import { ReactiveVar } from 'meteor/reactive-var';
import { Random } from 'meteor/random';
import { Tracker } from 'meteor/tracker';
import { FlowRouter } from 'meteor/kadira:flow-router';
import { Session } from 'meteor/session';
import s from 'underscore.string';

import { e2e } from '../../../e2e/client';
import { Users, ChatSubscription } from '../../../models';
import { getUserPreference } from '../../../utils';
import { getUserAvatarURL } from '../../../utils/lib/getUserAvatarURL';
import { CustomSounds } from '../../../custom-sounds/client/lib/CustomSounds';
import { getAvatarAsPng } from '../../../../client/lib/utils/getAvatarAsPng';
import { onClientMessageReceived } from '../../../../client/lib/onClientMessageReceived';

export const KonchatNotification = {
	notificationStatus: new ReactiveVar(),
	getDesktopPermission() {
		if (window.Notification && Notification.permission !== 'granted') {
			return Notification.requestPermission(function (status) {
				KonchatNotification.notificationStatus.set(status);
				if (Notification.permission !== status) {
					Notification.permission = status;
				}
			});
		}
	},

	notify(notification) {
		if (window.Notification && Notification.permission === 'granted') {
			const message = {
				rid: notification.payload != null ? notification.payload.rid : undefined,
				msg: notification.text,
				notification: true,
			};
			return onClientMessageReceived(message).then(function (message) {
				const requireInteraction = getUserPreference(Meteor.userId(), 'desktopNotificationRequireInteraction');
				const n = new Notification(notification.title, {
					icon: notification.icon || getUserAvatarURL(notification.payload.sender.username),
					body: s.stripTags(message.msg),
					tag: notification.payload._id,
					canReply: true,
					silent: true,
					requireInteraction,
				});

				const notificationDuration = !requireInteraction && (notification.duration - 0 || 10);
				if (notificationDuration > 0) {
					setTimeout(() => n.close(), notificationDuration * 1000);
				}

				if (notification.payload && notification.payload.rid) {
					if (n.addEventListener) {
						n.addEventListener('reply', ({ response }) =>
							Meteor.call('sendMessage', {
								_id: Random.id(),
								rid: notification.payload.rid,
								msg: response,
							}),
						);
					}

					n.onclick = function () {
						this.close();
						window.focus();
						switch (notification.payload.type) {
							case 'd':
								return FlowRouter.go(
									'direct',
									{
										rid: notification.payload.rid,
										...(notification.payload.tmid && {
											tab: 'thread',
											context: notification.payload.tmid,
										}),
									},
									{ ...FlowRouter.current().queryParams, jump: notification.payload._id },
								);
							case 'c':
								return FlowRouter.go(
									'channel',
									{
										name: notification.payload.name,
										...(notification.payload.tmid && {
											tab: 'thread',
											context: notification.payload.tmid,
										}),
									},
									{ ...FlowRouter.current().queryParams, jump: notification.payload._id },
								);
							case 'p':
								return FlowRouter.go(
									'group',
									{
										name: notification.payload.name,
										...(notification.payload.tmid && {
											tab: 'thread',
											context: notification.payload.tmid,
										}),
									},
									{ ...FlowRouter.current().queryParams, jump: notification.payload._id },
								);
						}
					};
				}
			});
		}
	},

	async showDesktop(notification) {
		if (
			notification.payload.rid === Session.get('openedRoom') &&
			(typeof window.document.hasFocus === 'function' ? window.document.hasFocus() : undefined)
		) {
			return;
		}

		if (Meteor.user().status === 'busy') {
			return;
		}

		if (notification.payload.message && notification.payload.message.t === 'e2e') {
			const e2eRoom = await e2e.getInstanceByRoomId(notification.payload.rid);
			if (e2eRoom) {
				notification.text = (await e2eRoom.decrypt(notification.payload.message.msg)).text;
			}
		}

		return getAvatarAsPng(notification.payload.sender.username, function (avatarAsPng) {
			notification.icon = avatarAsPng;
			return KonchatNotification.notify(notification);
		});
	},

	newMessageSound(rid) {
		if (Session.equals(`user_${Meteor.user().username}_status`, 'busy')) {
			return;
		}

		const userId = Meteor.userId();
		const newMessageNotification = getUserPreference(userId, 'newMessageNotification');

		const volume = Number((getUserPreference(userId, 'notificationsSoundVolume') / 100).toPrecision(2));

		if (!volume) {
			return;
		}

		const sub = ChatSubscription.findOne({ rid }, { fields: { audioNotificationValue: 1 } });

		const sound = sub?.audioNotificationValue || newMessageNotification;

		if (newMessageNotification === 'none') {
			return;
		}
		return CustomSounds.play(sound, {
			volume,
		});
	},

	newRoomSound(loop = false) {
		const user = Users.findOne(Meteor.userId(), {
			fields: {
				'settings.preferences.newRoomNotification': 1,
				'settings.preferences.notificationsSoundVolume': 1,
			},
		});
		const newRoomNotification = getUserPreference(user, 'newRoomNotification');

		if (newRoomNotification === 'none') {
			return;
		}

		const volume = Number((getUserPreference(user, 'notificationsSoundVolume') / 100).toPrecision(2));

		if (!volume) {
			return;
		}

		return CustomSounds.play(newRoomNotification, {
			loop,
			volume,
		});
	},
};
