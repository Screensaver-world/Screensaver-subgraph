import { Bytes, JSONValueKind, ipfs, json, log, ethereum } from '@graphprotocol/graph-ts'
import {
  Contract,
  Approval,
  Bid as BidEvent,
  AcceptBid as AcceptBidEvent,
  CancelBid as CancelBidEvent,
  ApprovalForAll,
  OwnershipTransferred,
  Transfer as TransferEvent
} from "../generated/Contract/Contract"
// import { ExampleEntity } from "../generated/schema"
import { getOrCreateAccount } from './entities/account'
import { integer, ADDRESS_ZERO } from '@protofire/subgraph-toolkit'
import { Artwork, BidLog } from '../generated/schema'
import { getIpfsHash } from './helpers'

export function handleBid(event: BidEvent): void {
  let tokenId = event.params._tokenId.toString()
  let item = Artwork.load(tokenId)

  if (item != null) {
    let bidder = getOrCreateAccount(event.params.bidder)

    // Persist bid log
    let bid = new BidLog(tokenId + '-' + bidder.id + '-' + event.block.timestamp.toString())
    bid.amount = event.params._newBid
    bid.bidder = bidder.id
    bid.item = item.id
    bid.timestamp = event.block.timestamp
    bid.accepted = false
    bid.canceled = false

    bid.save()

    // Update current bidder
    item.currentBid = bid.id

    item.save()
  }
}

export function handleAcceptBid(event: AcceptBidEvent): void {
  let tokenId = event.params._tokenId.toString()
  let item = Artwork.load(tokenId)

  if (item != null) {
    item.forSale = false 
    item.save()

    let bid = BidLog.load(item.currentBid)
    bid.accepted = true
    bid.save()
  }
}

export function handleCancelBid(event: CancelBidEvent): void {
  let tokenId = event.params._tokenId.toString()
  let item = Artwork.load(tokenId)

  if (item != null) {
    let bid = BidLog.load(item.currentBid)
    bid.canceled = true
    bid.save()
  }
}

export function handleApproval(event: Approval): void {
  let tokenId = event.params.tokenId.toString()
  let item = Artwork.load(tokenId)

  if (item != null) {
    item.forSale = true 
    item.save()
  }
}

export function handleApprovalForAll(event: ApprovalForAll): void {}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {}

export function handleTransfer(event: TransferEvent): void {
  let account = getOrCreateAccount(event.params.to)
  let tokenId = event.params.tokenId.toString()

  if (event.params.from.toHex() == ADDRESS_ZERO) {

    // Mint token
    let item = new Artwork(tokenId)
    item.creator = account.id
    item.owner = item.creator
    item.tokenId = event.params.tokenId
    item.creationDate = event.block.timestamp
    item.burned = false
    let uri = Contract.bind(event.address).tokenURI(event.params.tokenId)

    if (!!uri) {
      item.metadataUri = uri 
      item.broken = false
    } else {
      item.broken = true
    }

    readArtworkMetadata(item as Artwork).save()

    item.save()

  } else {

    let item = Artwork.load(tokenId)

    if (item != null) {
      if (event.params.to.toHex() == ADDRESS_ZERO) {
        // Burn token
        item.removed = event.block.timestamp
        item.burned = true 
      } else {
        // Transfer token
        item.owner = account.id
        item.modified = event.block.timestamp
      }

      item.save()
    } else {
      log.warning('Artwork #{} not exists', [tokenId])
    }
  }


}

function readArtworkMetadata(item: Artwork): Artwork {
  let hash = getIpfsHash(item.metadataUri)
  if (hash != null) {
    item.metadataUri = `https://ipfs.io/ipfs/${hash}`

    let raw = ipfs.cat(hash)

    item.metadataHash = hash

    if (raw != null) {
      let value = json.fromBytes(raw as Bytes)

      if (value.kind == JSONValueKind.OBJECT) {
        let data = value.toObject()

        if (data.isSet('name')) {
          item.name = data.get('name').toString()
        }

        if (data.isSet('description')) {
          item.description = data.get('description').toString()
        }

        // if (data.isSet('creationDate')) {
        //   item.creationDate = data.get('creationDate').toString()
        // }

        if (data.isSet('image')) {
          item.mediaUri = data.get('image').toString()
          item.mediaHash = getIpfsHash(item.mediaUri)
        }

        if (data.isSet('animation_url')) {
          item.mediaUri = data.get('animation_url').toString()
          item.mediaHash = getIpfsHash(item.mediaUri)
        }

        if (data.isSet('media')) {

          let media = data.get('media').toObject()

          if (media.isSet('mimeType')) {
            item.mimeType = media.get('mimeType').toString()
          }

          if (media.isSet('size')) {
            item.size = media.get('size').toBigInt()
          }

        }

        if (data.isSet('tags')) {

          if (data.get('tags').toArray() !== []) {
            item.tags = data
            .get('tags')
            .toArray()
            .map<string>(t => t.toString())

            item.tagsString = item.tags.join(" ")
          }

        }

      }
    }
  } else {
    item.broken = true
  }

  return item
}
