## Default Permission

允许使用语音合成（TTS）：
查询支持与引擎状态、初始化引擎、朗读/停止、读取中文音色列表、切换后端。
（不需要额外运行时权限；Android 11+ 的 TTS 引擎可见性由 AndroidManifest 的 queries 声明）

#### This default permission set includes the following:

- `allow-tts-supported`
- `allow-tts-prepare`
- `allow-tts-speak`
- `allow-tts-stop`
- `allow-tts-status`
- `allow-tts-voices`
- `allow-tts-set-backend`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`onethu-tts:allow-tts-prepare`

</td>
<td>

Enables the tts_prepare command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-tts:allow-tts-set-backend`

</td>
<td>

Enables the tts_set_backend command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-tts:allow-tts-speak`

</td>
<td>

Enables the tts_speak command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-tts:allow-tts-status`

</td>
<td>

Enables the tts_status command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-tts:allow-tts-stop`

</td>
<td>

Enables the tts_stop command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-tts:allow-tts-supported`

</td>
<td>

Enables the tts_supported command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-tts:allow-tts-voices`

</td>
<td>

Enables the tts_voices command without any pre-configured scope.

</td>
</tr>
</table>
